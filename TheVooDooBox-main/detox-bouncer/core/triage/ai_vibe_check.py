"""
ExtensionDetox - AI Vibe Check

Sends extension source code to the TheVooDooBox AI (llama.cpp on 192.168.50.98)
for semantic analysis of malicious intent.

Uses the OpenAI-compatible /v1/chat/completions endpoint.
Handles token chunking for large files.
"""

import json
import logging
import os
import zipfile
from pathlib import Path
from typing import Optional

import requests
import yaml

logger = logging.getLogger("ExtensionDetox.VibeCheck")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PROMPT_PATH = PROJECT_ROOT / "prompts" / "vibe_check.txt"
CONFIG_PATH = PROJECT_ROOT / "config.yaml"


def load_system_prompt() -> str:
    """Load the Vibe Check system prompt from file."""
    with open(PROMPT_PATH, "r") as f:
        return f.read()


def load_config() -> dict:
    """Load config.yaml."""
    with open(CONFIG_PATH, "r") as f:
        return yaml.safe_load(f)


class AIVibeChecker:
    """
    Sends extension source code to llama.cpp for AI-powered
    static analysis (the "Vibe Check").

    Features:
    - Automatic source extraction from VSIX archives
    - Token-aware chunking for large files
    - Structured JSON response parsing
    - Fallback for unresponsive AI
    """

    # Approximate characters per token for estimation
    CHARS_PER_TOKEN = 4

    def __init__(self, config: dict = None):
        self.config = config or load_config()
        ai_cfg = self.config.get("ai", {})

        self.base_url = ai_cfg.get("inference_url", "http://192.168.50.98:11434")
        self.chat_endpoint = ai_cfg.get("chat_endpoint", "/v1/chat/completions")
        self.model = ai_cfg.get("model", "llama-server")
        self.max_tokens = ai_cfg.get("max_tokens", 4096)
        self.temperature = ai_cfg.get("temperature", 0.1)

        self.system_prompt = load_system_prompt()
        self.session = requests.Session()

    def _estimate_tokens(self, text: str) -> int:
        """Rough token count estimation."""
        return len(text) // self.CHARS_PER_TOKEN

    def _chunk_source(self, source: str, max_chunk_tokens: int = 2000) -> list[str]:
        """
        Split source code into chunks that fit within the model's context.

        Splits on function/class boundaries when possible.
        """
        max_chars = max_chunk_tokens * self.CHARS_PER_TOKEN

        if len(source) <= max_chars:
            return [source]

        chunks = []
        lines = source.split("\n")
        current_chunk = []
        current_size = 0

        for line in lines:
            line_size = len(line) + 1  # +1 for newline
            if current_size + line_size > max_chars and current_chunk:
                chunks.append("\n".join(current_chunk))
                current_chunk = []
                current_size = 0
            current_chunk.append(line)
            current_size += line_size

        if current_chunk:
            chunks.append("\n".join(current_chunk))

        return chunks

    def _call_ai(self, source_code: str, filename: str = "extension.js") -> dict:
        """
        Make a single AI inference call.

        Returns:
            Parsed JSON response from the AI, or a fallback error dict.
        """
        url = f"{self.base_url}{self.chat_endpoint}"

        user_message = (
            f"Analyze the following VS Code extension source file: `{filename}`\n\n"
            f"```javascript\n{source_code}\n```"
        )

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": user_message},
            ],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "stream": False,
        }

        try:
            resp = self.session.post(
                url,
                json=payload,
                timeout=120,
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()

            # Extract the assistant's message content
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            # Parse JSON from the response (may be wrapped in markdown code blocks)
            parsed = self._parse_ai_response(content)
            parsed["raw_response"] = content
            return parsed

        except requests.exceptions.ConnectionError:
            msg = f"Cannot connect to AI server at {self.base_url}"
            logger.error(msg)
            return self._fallback_response(msg)

        except requests.exceptions.Timeout:
            msg = "AI request timed out"
            logger.error(msg)
            return self._fallback_response(msg)

        except requests.exceptions.HTTPError as http_err:
            status_code = http_err.response.status_code if http_err.response is not None else "Unknown"
            if status_code == 400:
                msg = f"AI server returned 400 (Bad Request). This usually means the input chunk + requested response ({self.max_tokens} tokens) exceeds the AI's context window (num_ctx). Try reducing chunk sizes or increasing num_ctx for the model."
            else:
                msg = f"AI call failed with status {status_code}: {http_err}"
            logger.error(msg)
            return self._fallback_response(msg)

        except Exception as e:
            msg = f"AI call failed: {e}"
            logger.error(msg)
            return self._fallback_response(msg)

    def _parse_ai_response(self, content: str) -> dict:
        """Parse JSON from the AI response, handling markdown code blocks."""
        # Try direct JSON parse
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            pass

        # Try extracting from markdown code block
        import re
        json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", content, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass

        # Fallback: return raw content as summary
        return {
            "risk_score": 0.5,
            "confidence": 0.3,
            "verdict": "SUSPICIOUS",
            "findings": [],
            "summary": f"AI returned non-JSON response: {content[:500]}",
            "raw_response": content,
        }

    def _fallback_response(self, reason: str) -> dict:
        """Generate a fallback response when AI is unavailable."""
        return {
            "risk_score": 0.5,
            "confidence": 0.0,
            "verdict": "UNKNOWN",
            "findings": [],
            "summary": f"AI analysis unavailable: {reason}",
            "error": reason,
            "raw_response": f"AI Vibe Check Fallback: {reason}. Check backend connectivity to {self.base_url}."
        }

    def analyze_source(self, source_code: str, filename: str = "extension.js") -> dict:
        """
        Analyze a source code string.

        For large files, splits into chunks and aggregates results.

        Returns:
            Combined AI analysis result dict.
        """
        chunks = self._chunk_source(source_code)

        if len(chunks) == 1:
            logger.info(f"AI Vibe Check: {filename} ({self._estimate_tokens(source_code)} est. tokens)")
            return self._call_ai(source_code, filename)

        # Multi-chunk analysis
        logger.info(f"AI Vibe Check: {filename} split into {len(chunks)} chunks")
        all_findings = []
        max_risk = 0.0
        verdicts = []
        summaries = []
        raw_responses = []

        for i, chunk in enumerate(chunks):
            chunk_name = f"{filename} (chunk {i + 1}/{len(chunks)})"
            logger.info(f"  Analyzing {chunk_name}...")
            result = self._call_ai(chunk, chunk_name)

            risk = result.get("risk_score", 0.0)
            if risk > max_risk:
                max_risk = risk

            verdicts.append(result.get("verdict", "UNKNOWN"))
            all_findings.extend(result.get("findings", []))
            summaries.append(result.get("summary", ""))
            
            if "raw_response" in result:
                raw_responses.append(f"=== {chunk_name} ===\n{result['raw_response']}")

        # Aggregate: worst-case verdict
        if "MALICIOUS" in verdicts:
            final_verdict = "MALICIOUS"
        elif "SUSPICIOUS" in verdicts:
            final_verdict = "SUSPICIOUS"
        else:
            final_verdict = "CLEAN"

        return {
            "risk_score": max_risk,
            "confidence": 0.7,  # Lower confidence for chunked analysis
            "verdict": final_verdict,
            "findings": all_findings,
            "summary": " | ".join(summaries),
            "chunks_analyzed": len(chunks),
            "raw_response": "\n\n".join(raw_responses),
        }

    def analyze_vsix(self, vsix_path: str) -> dict:
        """
        Extract and analyze the main entry point(s) from a VSIX archive.

        Returns:
            Combined AI analysis result.
        """
        try:
            with zipfile.ZipFile(vsix_path, 'r') as zf:
                # Find package.json to determine entry point
                pkg_data = None
                for candidate in ["extension/package.json", "package.json"]:
                    try:
                        pkg_data = json.loads(zf.read(candidate).decode("utf-8"))
                        break
                    except (KeyError, json.JSONDecodeError):
                        continue

                if not pkg_data:
                    return self._fallback_response("No package.json found")

                # Determine entry points
                entry_files = []
                main = pkg_data.get("main", "")
                browser = pkg_data.get("browser", "")
                
                potential_mains = []
                if main: potential_mains.append(main)
                if browser: potential_mains.append(browser)
                
                for start_file in potential_mains:
                    # Clean the path
                    clean = start_file[2:] if start_file.startswith("./") else start_file
                    
                    # Add variations to check
                    variations = [
                        f"extension/{clean}",
                        clean,
                        f"extension/{clean}.js",
                        f"{clean}.js",
                        f"extension/{clean}/index.js",
                        f"{clean}/index.js"
                    ]
                    entry_files.extend(variations)

                available = set(zf.namelist())
                targets = []
                seen_targets = set()
                
                for f in entry_files:
                    if f in available and f not in seen_targets:
                        targets.append(f)
                        seen_targets.add(f)

                if not targets:
                    return self._fallback_response(f"Entry point not found: {main or browser}")

                # Analyze each entry point
                all_results = []
                for target in targets[:2]:  # Max 2 entry points
                    source = zf.read(target).decode("utf-8", errors="replace")
                    result = self.analyze_source(source, target)
                    all_results.append(result)

                # Merge results (worst-case)
                if len(all_results) == 1:
                    return all_results[0]

                merged_findings = []
                max_risk = 0.0
                raw_responses = []
                for r in all_results:
                    merged_findings.extend(r.get("findings", []))
                    if r.get("risk_score", 0) > max_risk:
                        max_risk = r["risk_score"]
                    if "raw_response" in r:
                        raw_responses.append(r["raw_response"])

                verdicts = [r.get("verdict", "UNKNOWN") for r in all_results]
                if "MALICIOUS" in verdicts:
                    final_verdict = "MALICIOUS"
                elif "SUSPICIOUS" in verdicts:
                    final_verdict = "SUSPICIOUS"
                else:
                    final_verdict = "CLEAN"

                return {
                    "risk_score": max_risk,
                    "confidence": min(r.get("confidence", 0.5) for r in all_results),
                    "verdict": final_verdict,
                    "findings": merged_findings,
                    "summary": " | ".join(r.get("summary", "") for r in all_results),
                    "entry_points_analyzed": targets[:2],
                    "raw_response": "\n\n".join(raw_responses),
                }

        except zipfile.BadZipFile:
            return self._fallback_response("Invalid VSIX archive")
        except Exception as e:
            return self._fallback_response(str(e))


def vibe_check_vsix(vsix_path: str, config: dict = None) -> dict:
    """Convenience function to run AI Vibe Check on a VSIX."""
    checker = AIVibeChecker(config)
    return checker.analyze_vsix(vsix_path)
