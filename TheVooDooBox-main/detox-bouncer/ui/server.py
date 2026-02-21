"""
ExtensionDetox - API Server

Lightweight Flask-based REST API for the Mission Control dashboard.
Serves scan data, reports, and queue status to the frontend.
"""

import json
import logging
import sys
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from db.models import init_db

logger = logging.getLogger("ExtensionDetox.API")

# Global DB connection
_conn = None
STATIC_DIR = Path(__file__).parent / "static"


def get_conn():
    global _conn
    if _conn is None:
        _conn = init_db(str(PROJECT_ROOT / "data" / "extensiondetox.db"))
    return _conn


class APIHandler(SimpleHTTPRequestHandler):
    """REST API handler for the dashboard."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            self._handle_api(path, parse_qs(parsed.query))
        else:
            # Serve static files
            if path == "/" or path == "":
                self.path = "/index.html"
            super().do_GET()

    def _handle_api(self, path: str, params: dict):
        """Route API requests."""
        conn = get_conn()

        try:
            if path == "/api/dashboard":
                data = self._get_dashboard_stats(conn)
            elif path == "/api/extensions":
                data = self._get_extensions(conn, params)
            elif path == "/api/extension":
                ext_id = params.get("id", [None])[0]
                data = self._get_extension_detail(conn, ext_id)
            elif path == "/api/queue":
                data = self._get_queue(conn)
            elif path == "/api/blocklist":
                data = self._get_blocklist_stats(conn)
            elif path == "/api/recent-scans":
                data = self._get_recent_scans(conn)
            else:
                self._send_json({"error": "Not found"}, 404)
                return

            self._send_json(data)

        except Exception as e:
            logger.error(f"API error: {e}")
            self._send_json({"error": str(e)}, 500)

    def _send_json(self, data: dict, status: int = 200):
        """Send a JSON response."""
        body = json.dumps(data, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _get_dashboard_stats(self, conn) -> dict:
        """Get overview stats for the dashboard."""
        total = conn.execute("SELECT COUNT(*) as c FROM extensions").fetchone()["c"]
        queued = conn.execute("SELECT COUNT(*) as c FROM extensions WHERE scan_state = 'QUEUED'").fetchone()["c"]
        scanning = conn.execute("SELECT COUNT(*) as c FROM extensions WHERE scan_state IN ('DOWNLOADING','STATIC_SCANNING','DETONATING')").fetchone()["c"]
        clean = conn.execute("SELECT COUNT(*) as c FROM extensions WHERE scan_state = 'CLEAN'").fetchone()["c"]
        flagged = conn.execute("SELECT COUNT(*) as c FROM extensions WHERE scan_state = 'FLAGGED'").fetchone()["c"]
        reported = conn.execute("SELECT COUNT(*) as c FROM extensions WHERE scan_state = 'REPORTED'").fetchone()["c"]
        blocklist = conn.execute("SELECT COUNT(*) as c FROM blocklist").fetchone()["c"]
        publishers = conn.execute("SELECT COUNT(*) as c FROM publishers").fetchone()["c"]
        verified = conn.execute("SELECT COUNT(*) as c FROM publishers WHERE is_domain_verified = 1").fetchone()["c"]

        # Recent scan scores
        recent = conn.execute(
            "SELECT composite_score FROM scan_history WHERE composite_score IS NOT NULL ORDER BY id DESC LIMIT 20"
        ).fetchall()
        scores = [r["composite_score"] for r in recent]
        avg_score = sum(scores) / len(scores) if scores else 0

        return {
            "total_extensions": total,
            "queued": queued,
            "scanning": scanning,
            "clean": clean,
            "flagged": flagged,
            "reported": reported,
            "blocklist_count": blocklist,
            "publishers": publishers,
            "verified_publishers": verified,
            "average_risk_score": round(avg_score, 3),
            "recent_scores": scores,
        }

    def _get_extensions(self, conn, params: dict) -> dict:
        """Get paginated extension list."""
        page = int(params.get("page", [1])[0])
        limit = int(params.get("limit", [20])[0])
        state = params.get("state", [None])[0]
        offset = (page - 1) * limit

        where = ""
        args = []
        if state:
            where = "WHERE e.scan_state = ?"
            args.append(state)

        rows = conn.execute(
            f"""
            SELECT e.*, p.publisher_name, p.is_domain_verified,
                   sh.composite_score, sh.ai_vibe_score, sh.static_score
            FROM extensions e
            LEFT JOIN publishers p ON e.publisher_id = p.id
            LEFT JOIN (
                SELECT extension_db_id, composite_score, ai_vibe_score, static_score
                FROM scan_history
                WHERE id IN (SELECT MAX(id) FROM scan_history GROUP BY extension_db_id)
            ) sh ON sh.extension_db_id = e.id
            {where}
            ORDER BY e.updated_at DESC
            LIMIT ? OFFSET ?
            """,
            args + [limit, offset],
        ).fetchall()

        total = conn.execute(f"SELECT COUNT(*) as c FROM extensions e {where}", args).fetchone()["c"]

        return {
            "extensions": [dict(r) for r in rows],
            "total": total,
            "page": page,
            "pages": (total + limit - 1) // limit,
        }

    def _get_extension_detail(self, conn, ext_db_id: str) -> dict:
        """Get detailed info for a single extension."""
        if not ext_db_id:
            return {"error": "Missing id parameter"}

        ext = conn.execute("SELECT * FROM extensions WHERE id = ?", (ext_db_id,)).fetchone()
        if not ext:
            return {"error": "Extension not found"}

        data = dict(ext)

        # Publisher
        if ext["publisher_id"]:
            pub = conn.execute("SELECT * FROM publishers WHERE id = ?", (ext["publisher_id"],)).fetchone()
            if pub:
                data["publisher"] = dict(pub)

        # Scan history
        scans = conn.execute(
            "SELECT * FROM scan_history WHERE extension_db_id = ? ORDER BY id DESC",
            (ext_db_id,),
        ).fetchall()
        data["scans"] = [dict(s) for s in scans]

        # Static findings
        findings = conn.execute(
            "SELECT * FROM static_findings WHERE extension_db_id = ? ORDER BY severity DESC",
            (ext_db_id,),
        ).fetchall()
        data["findings"] = [dict(f) for f in findings]

        # IOCs
        iocs = conn.execute(
            """
            SELECT i.* FROM iocs i
            JOIN scan_history sh ON i.scan_history_id = sh.id
            WHERE sh.extension_db_id = ?
            """,
            (ext_db_id,),
        ).fetchall()
        data["iocs"] = [dict(i) for i in iocs]

        # Blocklist check
        bl = conn.execute(
            "SELECT * FROM blocklist WHERE extension_id = ?",
            (ext["extension_id"],),
        ).fetchone()
        data["blocklist"] = dict(bl) if bl else None

        return data

    def _get_queue(self, conn) -> dict:
        """Get current scan queue."""
        rows = conn.execute(
            """
            SELECT e.id, e.extension_id, e.version, e.scan_state,
                   e.install_count, e.updated_at,
                   p.publisher_name, p.is_domain_verified
            FROM extensions e
            LEFT JOIN publishers p ON e.publisher_id = p.id
            WHERE e.scan_state IN ('QUEUED','DOWNLOADING','STATIC_SCANNING','DETONATING')
            ORDER BY e.created_at
            """,
        ).fetchall()
        return {"queue": [dict(r) for r in rows]}

    def _get_blocklist_stats(self, conn) -> dict:
        """Get blocklist breakdown by type."""
        rows = conn.execute(
            "SELECT removal_type, COUNT(*) as count FROM blocklist GROUP BY removal_type",
        ).fetchall()
        return {
            "entries": [dict(r) for r in rows],
            "total": sum(r["count"] for r in rows),
        }

    def _get_recent_scans(self, conn) -> dict:
        """Get recent scan results."""
        rows = conn.execute(
            """
            SELECT sh.*, e.extension_id, e.version, e.display_name
            FROM scan_history sh
            JOIN extensions e ON sh.extension_db_id = e.id
            WHERE sh.composite_score IS NOT NULL
            ORDER BY sh.id DESC LIMIT 10
            """,
        ).fetchall()
        return {"scans": [dict(r) for r in rows]}

    def log_message(self, format, *args):
        """Suppress default logging noise."""
        if "/api/" in str(args[0]):
            logger.debug(format % args)


def run_server(host: str = "0.0.0.0", port: int = 8888):
    """Start the API server."""
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] [%(levelname)s] %(name)s: %(message)s",
    )
    server = HTTPServer((host, port), APIHandler)
    logger.info(f"ExtensionDetox Mission Control: http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Server stopped.")
        server.server_close()


if __name__ == "__main__":
    run_server()
