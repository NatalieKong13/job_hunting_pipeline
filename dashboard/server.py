#!/usr/bin/env python3
"""Local job dashboard API + static server backed by SQLite."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from ai_search import get_status as ai_search_status
from ai_search import load_dotenv
from ai_search import run_ai_search

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "jobs.db"
PORT = 8765

_lock = threading.Lock()
load_dotenv()


def today() -> str:
    return date.today().isoformat()


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with _lock:
        conn = connect()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS meta (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS catalog (
                  id TEXT PRIMARY KEY,
                  company TEXT NOT NULL,
                  title TEXT NOT NULL,
                  location TEXT,
                  salary TEXT,
                  url TEXT,
                  notes TEXT,
                  added_at TEXT,
                  posted_at TEXT,
                  role_type TEXT,
                  big_tech INTEGER DEFAULT 0,
                  source TEXT,
                  payload TEXT
                );

                CREATE TABLE IF NOT EXISTS queue (
                  id TEXT PRIMARY KEY,
                  company TEXT NOT NULL,
                  title TEXT NOT NULL,
                  location TEXT,
                  salary TEXT,
                  url TEXT,
                  notes TEXT,
                  added_at TEXT,
                  posted_at TEXT,
                  role_type TEXT,
                  big_tech INTEGER DEFAULT 0,
                  source TEXT,
                  payload TEXT
                );

                CREATE TABLE IF NOT EXISTS applications (
                  id TEXT PRIMARY KEY,
                  company TEXT NOT NULL,
                  title TEXT NOT NULL,
                  url TEXT,
                  applied_at TEXT NOT NULL,
                  jd TEXT,
                  queue_id TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_apps_applied_at ON applications(applied_at);
                CREATE INDEX IF NOT EXISTS idx_queue_company ON queue(company);
                """
            )
            conn.execute(
                "INSERT OR IGNORE INTO meta(key, value) VALUES('updated_at', ?)",
                (today(),),
            )
            conn.commit()
        finally:
            conn.close()


def set_updated(conn: sqlite3.Connection) -> str:
    ts = today()
    conn.execute(
        "INSERT INTO meta(key, value) VALUES('updated_at', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (ts,),
    )
    return ts


def row_to_queue(row: sqlite3.Row) -> dict[str, Any]:
    item = {
        "id": row["id"],
        "company": row["company"],
        "title": row["title"],
        "location": row["location"] or "",
        "salary": row["salary"] or "",
        "url": row["url"] or "",
        "notes": row["notes"] or "",
        "addedAt": row["added_at"] or "",
        "postedAt": row["posted_at"] or None,
        "roleType": row["role_type"] or None,
        "bigTech": bool(row["big_tech"]),
        "source": row["source"] or "",
    }
    if not item["postedAt"]:
        item.pop("postedAt", None)
    if not item["roleType"]:
        item.pop("roleType", None)
    return item


def row_to_app(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "company": row["company"],
        "title": row["title"],
        "url": row["url"] or "",
        "appliedAt": row["applied_at"],
        "jd": row["jd"] or "",
        "queueId": row["queue_id"],
    }


def normalize_url(url: str) -> str:
    """Keep identity query params (e.g. Indeed jk=); drop only tracking noise."""
    raw = (url or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw)
    qs = parse_qs(parsed.query, keep_blank_values=False)
    drop = {
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "utm_id",
        "fbclid",
        "gclid",
        "mc_cid",
        "mc_eid",
        "ref",
        "source",
    }
    keep = {k: v for k, v in qs.items() if k.lower() not in drop}
    # Prefer stable identity params when present (Indeed etc.)
    identity = ("jk", "jobid", "job_id", "gh_jid", "ashby_jid", "requisitionid")
    if any(k.lower() in {i.lower() for i in identity} for k in keep):
        keep = {
            k: v
            for k, v in keep.items()
            if k.lower() in {i.lower() for i in identity}
        }
    query = urlencode(keep, doseq=True)
    path = parsed.path.rstrip("/") or ""
    return urlunparse(
        (parsed.scheme.lower(), parsed.netloc.lower(), path, "", query, "")
    ).lower()


def job_key(job: dict[str, Any]) -> str:
    url = normalize_url(job.get("url") or "")
    if url:
        return f"url:{url}"
    company = (job.get("company") or "").lower().strip()
    title = (job.get("title") or "").lower().strip()
    return f"ct:{company}|{title}"


def get_state() -> dict[str, Any]:
    with _lock:
        conn = connect()
        try:
            updated = conn.execute(
                "SELECT value FROM meta WHERE key='updated_at'"
            ).fetchone()
            queue = [
                row_to_queue(r)
                for r in conn.execute("SELECT * FROM queue ORDER BY added_at DESC, id")
            ]
            apps = [
                row_to_app(r)
                for r in conn.execute(
                    "SELECT * FROM applications ORDER BY applied_at DESC, id"
                )
            ]
            return {
                "updatedAt": updated["value"] if updated else today(),
                "queue": queue,
                "applications": apps,
            }
        finally:
            conn.close()


def upsert_queue_item(conn: sqlite3.Connection, job: dict[str, Any]) -> None:
    payload = json.dumps(job, ensure_ascii=False)
    conn.execute(
        """
        INSERT INTO queue(
          id, company, title, location, salary, url, notes,
          added_at, posted_at, role_type, big_tech, source, payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          company=excluded.company,
          title=excluded.title,
          location=excluded.location,
          salary=excluded.salary,
          url=excluded.url,
          notes=excluded.notes,
          added_at=excluded.added_at,
          posted_at=excluded.posted_at,
          role_type=excluded.role_type,
          big_tech=excluded.big_tech,
          source=excluded.source,
          payload=excluded.payload
        """,
        (
            job.get("id"),
            job.get("company") or "",
            job.get("title") or "",
            job.get("location") or "",
            job.get("salary") or "",
            job.get("url") or "",
            job.get("notes") or "",
            job.get("addedAt") or today(),
            job.get("postedAt"),
            job.get("roleType"),
            1 if job.get("bigTech") else 0,
            job.get("source") or "",
            payload,
        ),
    )


def upsert_catalog_item(conn: sqlite3.Connection, job: dict[str, Any]) -> None:
    payload = json.dumps(job, ensure_ascii=False)
    conn.execute(
        """
        INSERT INTO catalog(
          id, company, title, location, salary, url, notes,
          added_at, posted_at, role_type, big_tech, source, payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          company=excluded.company,
          title=excluded.title,
          location=excluded.location,
          salary=excluded.salary,
          url=excluded.url,
          notes=excluded.notes,
          added_at=excluded.added_at,
          posted_at=excluded.posted_at,
          role_type=excluded.role_type,
          big_tech=excluded.big_tech,
          source=excluded.source,
          payload=excluded.payload
        """,
        (
            job.get("id"),
            job.get("company") or "",
            job.get("title") or "",
            job.get("location") or "",
            job.get("salary") or "",
            job.get("url") or "",
            job.get("notes") or "",
            job.get("addedAt") or today(),
            job.get("postedAt"),
            job.get("roleType"),
            1 if job.get("bigTech") else 0,
            job.get("source") or "",
            payload,
        ),
    )


def replace_state(queue: list[dict], applications: list[dict]) -> dict[str, Any]:
    with _lock:
        conn = connect()
        try:
            conn.execute("DELETE FROM queue")
            conn.execute("DELETE FROM applications")
            for job in queue:
                upsert_queue_item(conn, job)
            for app in applications:
                conn.execute(
                    """
                    INSERT INTO applications(id, company, title, url, applied_at, jd, queue_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        app.get("id"),
                        app.get("company") or "",
                        app.get("title") or "",
                        app.get("url") or "",
                        app.get("appliedAt") or today(),
                        app.get("jd") or app.get("notes") or "",
                        app.get("queueId"),
                    ),
                )
            updated = set_updated(conn)
            conn.commit()
            return {"ok": True, "updatedAt": updated}
        finally:
            conn.close()


def mark_applied(job_id: str) -> dict[str, Any]:
    with _lock:
        conn = connect()
        try:
            row = conn.execute("SELECT * FROM queue WHERE id=?", (job_id,)).fetchone()
            if not row:
                return {"ok": False, "error": "queue item not found"}
            job = row_to_queue(row)
            app_id = job_id.replace("q-", "a-", 1) if job_id.startswith("q-") else f"a-{job_id}"
            conn.execute("DELETE FROM queue WHERE id=?", (job_id,))
            conn.execute(
                """
                INSERT INTO applications(id, company, title, url, applied_at, jd, queue_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  company=excluded.company,
                  title=excluded.title,
                  url=excluded.url,
                  applied_at=excluded.applied_at,
                  jd=excluded.jd,
                  queue_id=excluded.queue_id
                """,
                (
                    app_id,
                    job["company"],
                    job["title"],
                    job.get("url") or "",
                    today(),
                    job.get("notes") or "",
                    job_id,
                ),
            )
            updated = set_updated(conn)
            conn.commit()
            return {"ok": True, "updatedAt": updated, "applicationId": app_id}
        finally:
            conn.close()


def move_back(app_id: str) -> dict[str, Any]:
    with _lock:
        conn = connect()
        try:
            row = conn.execute(
                "SELECT * FROM applications WHERE id=?", (app_id,)
            ).fetchone()
            if not row:
                return {"ok": False, "error": "application not found"}
            app = row_to_app(row)
            qid = app.get("queueId") or app_id.replace("a-", "q-", 1)
            conn.execute("DELETE FROM applications WHERE id=?", (app_id,))
            upsert_queue_item(
                conn,
                {
                    "id": qid,
                    "company": app["company"],
                    "title": app["title"],
                    "url": app.get("url") or "",
                    "notes": app.get("jd") or "",
                    "addedAt": today(),
                },
            )
            updated = set_updated(conn)
            conn.commit()
            return {"ok": True, "updatedAt": updated, "queueId": qid}
        finally:
            conn.close()


def refresh_unapplied() -> dict[str, Any]:
    with _lock:
        conn = connect()
        try:
            applied_rows = conn.execute("SELECT * FROM applications").fetchall()
            applied_keys = {
                job_key(
                    {
                        "url": r["url"],
                        "company": r["company"],
                        "title": r["title"],
                    }
                )
                for r in applied_rows
            }
            existing = {
                job_key(row_to_queue(r))
                for r in conn.execute("SELECT * FROM queue").fetchall()
            }
            # drop queue items already applied
            for r in conn.execute("SELECT * FROM queue").fetchall():
                if job_key(row_to_queue(r)) in applied_keys:
                    conn.execute("DELETE FROM queue WHERE id=?", (r["id"],))

            added = 0
            for r in conn.execute("SELECT * FROM catalog").fetchall():
                job = row_to_queue(r)
                k = job_key(job)
                if k in applied_keys or k in existing:
                    continue
                upsert_queue_item(conn, {**job, "addedAt": job.get("addedAt") or today()})
                existing.add(k)
                added += 1

            updated = set_updated(conn)
            conn.commit()
            return {"ok": True, "added": added, "updatedAt": updated}
        finally:
            conn.close()


def parse_data_js(path: Path) -> dict[str, Any]:
    """Load JOB_DATA from data.js via Node (handles JS object literals)."""
    seed = path.with_name("seed.json")
    # Prefer regenerating from data.js when Node is available
    try:
        import subprocess

        script = (
            "const fs=require('fs');const vm=require('vm');"
            "const ctx={window:{}};"
            f"vm.runInNewContext(fs.readFileSync({json.dumps(str(path))},'utf8'),ctx);"
            "process.stdout.write(JSON.stringify(ctx.window.JOB_DATA));"
        )
        out = subprocess.check_output(["node", "-e", script], cwd=str(path.parent))
        data = json.loads(out.decode("utf-8"))
        seed.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return data
    except Exception:
        if seed.exists():
            return json.loads(seed.read_text(encoding="utf-8"))
        raise


def import_from_data_js(force_queue: bool = False) -> dict[str, Any]:
    data_path = ROOT / "data.js"
    data = parse_data_js(data_path)
    queue = data.get("queue") or []
    apps = data.get("applications") or []

    with _lock:
        conn = connect()
        try:
            for job in queue:
                upsert_catalog_item(conn, job)

            # Seed queue only if empty or forced
            count = conn.execute("SELECT COUNT(*) AS c FROM queue").fetchone()["c"]
            if force_queue or count == 0:
                conn.execute("DELETE FROM queue")
                for job in queue:
                    upsert_queue_item(conn, job)

            app_count = conn.execute("SELECT COUNT(*) AS c FROM applications").fetchone()["c"]
            if force_queue or app_count == 0:
                conn.execute("DELETE FROM applications")
                for app in apps:
                    conn.execute(
                        """
                        INSERT INTO applications(id, company, title, url, applied_at, jd, queue_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            app.get("id"),
                            app.get("company") or "",
                            app.get("title") or "",
                            app.get("url") or "",
                            app.get("appliedAt") or today(),
                            app.get("jd") or app.get("notes") or "",
                            app.get("queueId"),
                        ),
                    )

            updated = set_updated(conn)
            conn.commit()
            return {
                "ok": True,
                "updatedAt": updated,
                "catalog": len(queue),
                "queueSeeded": force_queue or count == 0,
            }
        finally:
            conn.close()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _send_json(self, code: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> Any:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/health":
            self._send_json(200, {"ok": True, "db": str(DB_PATH)})
            return
        if path == "/api/state":
            self._send_json(200, get_state())
            return
        if path == "/api/ai-search":
            status = ai_search_status()
            payload = {"ok": True, **status}
            if status.get("status") == "finished":
                payload.update(get_state())
            self._send_json(200, payload)
            return
        if path in ("/", "/index.html"):
            # prefer no-cache for HTML so UI updates show
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        try:
            if path == "/api/state":
                body = self._read_json()
                result = replace_state(body.get("queue") or [], body.get("applications") or [])
                self._send_json(200, {**result, **get_state()})
                return
            if path == "/api/apply":
                body = self._read_json()
                result = mark_applied(body.get("id") or "")
                code = 200 if result.get("ok") else 404
                self._send_json(code, {**result, **get_state()} if result.get("ok") else result)
                return
            if path == "/api/unapply":
                body = self._read_json()
                result = move_back(body.get("id") or "")
                code = 200 if result.get("ok") else 404
                self._send_json(code, {**result, **get_state()} if result.get("ok") else result)
                return
            if path == "/api/refresh-queue":
                # re-import catalog from data.js then merge unapplied
                import_from_data_js(force_queue=False)
                result = refresh_unapplied()
                self._send_json(200, {**result, **get_state()})
                return
            if path == "/api/import-data-js":
                body = self._read_json()
                result = import_from_data_js(force_queue=bool(body.get("force")))
                self._send_json(200, {**result, **get_state()})
                return
            if path == "/api/ai-search":
                def after_agent() -> dict[str, Any]:
                    import_from_data_js(force_queue=False)
                    return refresh_unapplied()

                result = run_ai_search(on_done=after_agent)
                code = 200 if result.get("ok") else 400
                self._send_json(code, result)
                return
            self._send_json(404, {"ok": False, "error": "not found"})
        except Exception as exc:  # noqa: BLE001
            self._send_json(500, {"ok": False, "error": str(exc)})

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[dashboard] {self.address_string()} - {fmt % args}")


def main() -> None:
    init_db()
    # Seed catalog + queue from data.js on first run
    try:
        result = import_from_data_js(force_queue=False)
        print(f"DB ready at {DB_PATH}")
        print(f"Import: {result}")
    except Exception as exc:  # noqa: BLE001
        print(f"Import warning: {exc}")

    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Serving http://127.0.0.1:{PORT}/  (SQLite synced)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
