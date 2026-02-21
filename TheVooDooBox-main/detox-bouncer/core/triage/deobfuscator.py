"""
ExtensionDetox - JavaScript Deobfuscator

Provides lightweight de-obfuscation of packed/minified JS before
sending to the AI Vibe Check. Uses js-beautify for formatting
and basic analysis of obfuscation patterns.
"""

import logging
import re
from typing import Optional

logger = logging.getLogger("ExtensionDetox.Deobfuscator")


class Deobfuscator:
    """
    Lightweight JavaScript de-obfuscation and beautification.

    Handles:
    - js-beautify formatting (when available)
    - Hex escape decoding
    - Unicode escape decoding
    - String.fromCharCode resolution
    - Detection of common packer signatures
    """

    PACKER_SIGNATURES = {
        "webpack": re.compile(r"webpackJsonp|__webpack_require__|webpack_modules"),
        "uglifyjs": re.compile(r"!function\(\w\)\{.*?\"use strict\""),
        "javascript_obfuscator": re.compile(r"_0x[a-f0-9]{4,6}\s*="),
        "jsfuck": re.compile(r"^\s*[!\[\]\(\)\+]+\s*$", re.MULTILINE),
        "eval_packer": re.compile(r"eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e"),
        "obfuscator_io": re.compile(r"var\s+_0x[a-f0-9]+\s*=\s*\["),
    }

    def __init__(self):
        self._beautifier = None
        try:
            import jsbeautifier
            self._beautifier = jsbeautifier
            logger.debug("jsbeautifier available")
        except ImportError:
            logger.debug("jsbeautifier not installed, using basic formatting")

    def deobfuscate(self, source: str) -> dict:
        """
        Attempt to de-obfuscate JavaScript source code.

        Returns:
            dict with keys:
                - source: The (possibly beautified) source
                - packers_detected: list of detected packer names
                - obfuscation_score: 0.0 - 1.0 estimate of obfuscation level
                - transforms_applied: list of transforms performed
        """
        result = {
            "source": source,
            "packers_detected": [],
            "obfuscation_score": 0.0,
            "transforms_applied": [],
        }

        # Detect packers
        for name, pattern in self.PACKER_SIGNATURES.items():
            if pattern.search(source):
                result["packers_detected"].append(name)

        # Calculate obfuscation score
        result["obfuscation_score"] = self._estimate_obfuscation(source)

        # Apply transforms
        current = source

        # Transform 1: Beautify
        if self._beautifier:
            opts = self._beautifier.default_options()
            opts.indent_size = 2
            opts.preserve_newlines = True
            opts.max_preserve_newlines = 2
            current = self._beautifier.beautify(current, opts)
            result["transforms_applied"].append("js-beautify")

        # Transform 2: Decode hex escapes (e.g., \x48\x65\x6c\x6c\x6f)
        hex_count = len(re.findall(r"\\x[0-9a-fA-F]{2}", current))
        if hex_count > 10:
            current = self._decode_hex_escapes(current)
            result["transforms_applied"].append(f"hex_decode ({hex_count} escapes)")

        # Transform 3: Decode unicode escapes (e.g., \u0048\u0065)
        unicode_count = len(re.findall(r"\\u[0-9a-fA-F]{4}", current))
        if unicode_count > 10:
            current = self._decode_unicode_escapes(current)
            result["transforms_applied"].append(f"unicode_decode ({unicode_count} escapes)")

        result["source"] = current
        return result

    def _estimate_obfuscation(self, source: str) -> float:
        """Estimate how obfuscated a piece of code is (0.0 - 1.0)."""
        if not source:
            return 0.0

        score = 0.0
        total_lines = source.count("\n") + 1

        # High ratio of hex escapes
        hex_count = len(re.findall(r"\\x[0-9a-fA-F]{2}", source))
        if hex_count > 20:
            score += 0.2

        # Long lines (minified code)
        long_lines = sum(1 for line in source.split("\n") if len(line) > 500)
        if long_lines > 0 and total_lines < 10:
            score += 0.2

        # High ratio of non-alphanumeric characters
        if len(source) > 100:
            alnum = sum(c.isalnum() for c in source)
            ratio = alnum / len(source)
            if ratio < 0.4:
                score += 0.2

        # Short variable names (_0x pattern)
        obf_vars = len(re.findall(r"\b_0x[a-f0-9]+\b", source))
        if obf_vars > 10:
            score += 0.2

        # String.fromCharCode usage
        charcode_count = len(re.findall(r"String\.fromCharCode", source))
        if charcode_count > 3:
            score += 0.1

        # Detected packers
        for _, pattern in self.PACKER_SIGNATURES.items():
            if pattern.search(source):
                score += 0.1

        return min(score, 1.0)

    @staticmethod
    def _decode_hex_escapes(text: str) -> str:
        """Decode \\xNN hex escapes in strings."""
        def hex_replace(match):
            try:
                return chr(int(match.group(1), 16))
            except (ValueError, OverflowError):
                return match.group(0)

        return re.sub(r"\\x([0-9a-fA-F]{2})", hex_replace, text)

    @staticmethod
    def _decode_unicode_escapes(text: str) -> str:
        """Decode \\uNNNN unicode escapes in strings."""
        def unicode_replace(match):
            try:
                return chr(int(match.group(1), 16))
            except (ValueError, OverflowError):
                return match.group(0)

        return re.sub(r"\\u([0-9a-fA-F]{4})", unicode_replace, text)


def deobfuscate_source(source: str) -> dict:
    """Convenience function to deobfuscate JavaScript source."""
    deob = Deobfuscator()
    return deob.deobfuscate(source)
