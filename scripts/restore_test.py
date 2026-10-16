#!/usr/bin/env python3
"""Financial OS restore verification (PRD section 63).

Restores a pg_dump file into a SCRATCH database financial_os_restore_test,
verifies restored row counts match the source database, prints PASS/FAIL,
then drops the scratch database. Never touches financial_os or spot_ams.

Usage: python scripts/restore_test.py [path/to/dump]   (default: newest dump
in FINOS_BACKUP_DIR)
"""
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PG_BIN = Path(os.environ["LOCALAPPDATA"]) / "pgsql16" / "pg16" / "pgsql" / "bin"
SCRATCH = "financial_os_restore_test"
CORE = ["users", "accounts", "categories", "transactions", "budgets", "goals", "audit_logs"]


def load_url() -> str:
    m = re.search(r"^DATABASE_URL=(\S+)", (REPO / ".env").read_text(encoding="utf-8"), re.M)
    if not m:
        print("RESTORE_TEST_FAIL: DATABASE_URL missing from .env")
        sys.exit(1)
    return m.group(1)


def psql(url: str, sql: str) -> subprocess.CompletedProcess:
    return subprocess.run([str(PG_BIN / "psql.exe"), "-d", url, "-v", "ON_ERROR_STOP=1",
                           "-t", "-A", "-F", "=", "-c", sql], capture_output=True, text=True)


def counts(url: str) -> dict:
    sel = " UNION ALL ".join(f"SELECT '{t}' AS t, count(*)::text AS n FROM {t}" for t in CORE)
    r = psql(url, sel)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return dict(line.split("=", 1) for line in r.stdout.strip().splitlines())


def latest_dump() -> Path:
    d = Path(os.environ.get("FINOS_BACKUP_DIR") or (Path.home() / "OneDrive" / "FinancialOS-Backups"))
    dumps = sorted(d.glob("financial_os-*.dump"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not dumps:
        print("RESTORE_TEST_FAIL: no dumps in", d)
        sys.exit(1)
    return dumps[0]


def main() -> int:
    dump = Path(sys.argv[1]) if len(sys.argv) > 1 else latest_dump()
    if not dump.exists():
        print("RESTORE_TEST_FAIL: dump not found:", dump)
        return 1
    url = load_url()
    scratch_url = re.sub(r"/financial_os$", "/" + SCRATCH, url)
    if scratch_url == url:
        print("RESTORE_TEST_FAIL: cannot derive scratch URL (expected DATABASE_URL to end with /financial_os)")
        return 1

    print(f"Restore test: dump={dump}")
    print("  dropping scratch db if exists...")
    r = psql(url, f"DROP DATABASE IF EXISTS {SCRATCH}")
    if r.returncode != 0:
        print("RESTORE_TEST_FAIL:", r.stderr.strip())
        return 1
    r = psql(url, f"CREATE DATABASE {SCRATCH} OWNER financialos")
    if r.returncode != 0:
        print("RESTORE_TEST_FAIL:", r.stderr.strip())
        return 1
    try:
        print("  restoring dump into scratch db...")
        r = subprocess.run([str(PG_BIN / "pg_restore.exe"), "-d", scratch_url,
                            "--no-owner", "--no-privileges", str(dump)],
                           capture_output=True, text=True)
        if r.returncode > 1:  # 1 = non-fatal warnings
            print("RESTORE_TEST_FAIL: pg_restore exit", r.returncode, r.stderr.strip()[:500])
            return 1
        print("  comparing restored row counts vs source...")
        src = counts(url)
        dst = counts(scratch_url)
        for t in CORE:
            print(f"    {t}: source={src[t]} restored={dst[t]}")
        bad = [t for t in CORE if src[t] != dst[t]]
        if bad:
            print("RESTORE_TEST_FAIL: count mismatch on", ", ".join(bad))
            return 1
        print(f"RESTORE_TEST_PASS: {dump.name} -- {len(CORE)} core tables restored with matching counts")
        return 0
    finally:
        r = subprocess.run([str(PG_BIN / "psql.exe"), "-d", url, "-c", f"DROP DATABASE IF EXISTS {SCRATCH}"],
                           capture_output=True, text=True)
        print("  scratch db dropped:", "ok" if r.returncode == 0 else r.stderr.strip())


if __name__ == "__main__":
    sys.exit(main())
