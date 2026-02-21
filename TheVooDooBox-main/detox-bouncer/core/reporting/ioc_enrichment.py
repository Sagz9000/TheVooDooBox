"""
ExtensionDetox - IOC Enrichment

Enriches extracted Indicators of Compromise (IPs, domains, hashes)
against external threat intelligence APIs:
- VirusTotal (hash, IP, domain lookups)
- AlienVault OTX (pulse/indicator lookups)

Uses TheVooDooBox's existing VIRUSTOTAL_API_KEY env var.
"""

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Optional

import requests

logger = logging.getLogger("ExtensionDetox.IOCEnrichment")


@dataclass
class EnrichmentResult:
    """Result of enriching a single IOC."""
    ioc_type: str           # IP, DOMAIN, HASH, URL
    ioc_value: str
    source: str             # virustotal, otx, etc.
    malicious: bool = False
    detection_count: int = 0
    total_engines: int = 0
    tags: list = field(default_factory=list)
    raw_data: dict = field(default_factory=dict)
    error: str = ""


class VirusTotalEnricher:
    """
    Query VirusTotal API v3 for IOC enrichment.

    Supports:
    - File hash lookups (SHA256, MD5, SHA1)
    - IP address reports
    - Domain reports
    """

    BASE_URL = "https://www.virustotal.com/api/v3"

    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.environ.get("VIRUSTOTAL_API_KEY", "")
        if not self.api_key:
            logger.warning("VIRUSTOTAL_API_KEY not set. VT enrichment disabled.")

        self.session = requests.Session()
        self.session.headers.update({
            "x-apikey": self.api_key,
            "Accept": "application/json",
        })
        # Rate limit: VT free tier = 4 requests/minute
        self._last_request = 0
        self._min_interval = 15.0  # seconds between requests

    def _rate_limit(self):
        """Enforce rate limiting for the free VT API tier."""
        elapsed = time.time() - self._last_request
        if elapsed < self._min_interval:
            wait = self._min_interval - elapsed
            logger.debug(f"VT rate limit: waiting {wait:.1f}s")
            time.sleep(wait)
        self._last_request = time.time()

    def _request(self, endpoint: str) -> Optional[dict]:
        """Make a rate-limited GET request to VT API."""
        if not self.api_key:
            return None

        self._rate_limit()
        url = f"{self.BASE_URL}/{endpoint}"

        try:
            resp = self.session.get(url, timeout=30)
            if resp.status_code == 404:
                return None  # Not found in VT
            if resp.status_code == 429:
                logger.warning("VT rate limit hit (429). Backing off...")
                time.sleep(60)
                return None
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"VT request failed: {e}")
            return None

    def lookup_hash(self, file_hash: str) -> EnrichmentResult:
        """
        Look up a file hash (SHA256/MD5/SHA1) in VirusTotal.

        Returns enrichment result with detection counts.
        """
        result = EnrichmentResult(
            ioc_type="HASH",
            ioc_value=file_hash,
            source="virustotal",
        )

        data = self._request(f"files/{file_hash}")
        if not data:
            result.error = "Not found in VirusTotal"
            return result

        attrs = data.get("data", {}).get("attributes", {})
        stats = attrs.get("last_analysis_stats", {})

        result.detection_count = stats.get("malicious", 0) + stats.get("suspicious", 0)
        result.total_engines = sum(stats.values())
        result.malicious = result.detection_count > 0
        result.tags = attrs.get("tags", [])
        result.raw_data = {
            "stats": stats,
            "type_description": attrs.get("type_description", ""),
            "meaningful_name": attrs.get("meaningful_name", ""),
            "first_submission_date": attrs.get("first_submission_date"),
            "last_analysis_date": attrs.get("last_analysis_date"),
        }

        logger.info(
            f"VT hash lookup: {file_hash[:16]}... = "
            f"{result.detection_count}/{result.total_engines} detections"
        )
        return result

    def lookup_ip(self, ip_address: str) -> EnrichmentResult:
        """Look up an IP address in VirusTotal."""
        result = EnrichmentResult(
            ioc_type="IP",
            ioc_value=ip_address,
            source="virustotal",
        )

        data = self._request(f"ip_addresses/{ip_address}")
        if not data:
            result.error = "Not found in VirusTotal"
            return result

        attrs = data.get("data", {}).get("attributes", {})
        stats = attrs.get("last_analysis_stats", {})

        result.detection_count = stats.get("malicious", 0) + stats.get("suspicious", 0)
        result.total_engines = sum(stats.values())
        result.malicious = result.detection_count > 3  # IP threshold higher
        result.tags = attrs.get("tags", [])
        result.raw_data = {
            "stats": stats,
            "country": attrs.get("country", ""),
            "as_owner": attrs.get("as_owner", ""),
            "network": attrs.get("network", ""),
        }

        logger.info(f"VT IP lookup: {ip_address} = {result.detection_count} detections")
        return result

    def lookup_domain(self, domain: str) -> EnrichmentResult:
        """Look up a domain in VirusTotal."""
        result = EnrichmentResult(
            ioc_type="DOMAIN",
            ioc_value=domain,
            source="virustotal",
        )

        data = self._request(f"domains/{domain}")
        if not data:
            result.error = "Not found in VirusTotal"
            return result

        attrs = data.get("data", {}).get("attributes", {})
        stats = attrs.get("last_analysis_stats", {})

        result.detection_count = stats.get("malicious", 0) + stats.get("suspicious", 0)
        result.total_engines = sum(stats.values())
        result.malicious = result.detection_count > 2
        result.tags = attrs.get("tags", [])
        result.raw_data = {
            "stats": stats,
            "registrar": attrs.get("registrar", ""),
            "creation_date": attrs.get("creation_date"),
            "categories": attrs.get("categories", {}),
        }

        logger.info(f"VT domain lookup: {domain} = {result.detection_count} detections")
        return result


class IOCEnricher:
    """
    Coordinates IOC enrichment across multiple threat intelligence sources.

    Dispatches IOCs to the appropriate enrichment service based on type.
    """

    def __init__(self, vt_api_key: str = None):
        self.vt = VirusTotalEnricher(api_key=vt_api_key)

    def enrich(self, ioc_type: str, ioc_value: str) -> list[EnrichmentResult]:
        """
        Enrich a single IOC against all available sources.

        Args:
            ioc_type: IP, DOMAIN, HASH, URL
            ioc_value: The indicator value

        Returns:
            List of EnrichmentResult from each source.
        """
        results = []

        if ioc_type == "HASH":
            results.append(self.vt.lookup_hash(ioc_value))
        elif ioc_type == "IP":
            results.append(self.vt.lookup_ip(ioc_value))
        elif ioc_type == "DOMAIN":
            results.append(self.vt.lookup_domain(ioc_value))
        elif ioc_type == "URL":
            # Extract domain from URL for lookup
            from urllib.parse import urlparse
            parsed = urlparse(ioc_value)
            if parsed.hostname:
                results.append(self.vt.lookup_domain(parsed.hostname))
        else:
            logger.warning(f"Unknown IOC type: {ioc_type}")

        return results

    def enrich_vsix_hash(self, sha256_hash: str) -> EnrichmentResult:
        """Convenience: enrich a VSIX file hash."""
        return self.vt.lookup_hash(sha256_hash)

    def enrich_batch(self, iocs: list[dict]) -> list[EnrichmentResult]:
        """
        Enrich a batch of IOCs.

        Args:
            iocs: List of dicts with 'ioc_type' and 'ioc_value' keys.

        Returns:
            List of all enrichment results.
        """
        all_results = []
        for ioc in iocs:
            results = self.enrich(ioc["ioc_type"], ioc["ioc_value"])
            all_results.extend(results)
        return all_results
