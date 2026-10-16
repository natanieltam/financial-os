#!/usr/bin/env python3
"""Financial OS backup (PRD section 62).

Dumps the financial_os database to FINOS_BACKUP_DIR (default:
%USERPROFILE%/OneDrive/FinancialOS-Backups -- synced off-machine, so the
backup is stored separately from the primary database). Connection string is
read from the git-ignored .env; no secret is stored in this script or in Git.

Keeps the newest 30 dumps, deletes older ones. Exit 0 on success.
"""
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PG_BIN = Path(os.environ["LOCALAPPDATA"]) / "pgsql16" / "pg16" / "pgsql" / "bin"
KEEP = 30


def db_url() -> str:
    env_file = REPO / ".env"
    if not env_file.exists():
        print("BACKUP_FAIL: .env not found")
        sys.exit(1)
    m = re.search(r"^DATABASE_URL=(\S+)", env_file.read_text(encoding="utf-8"), re.M)
    if not m:
        print("BACKUP_FAIL: DATABASE_URL missing from .env")
        sys.exit(1)
    return m.group(1)


def main() -> int:
    if not shutil.which(str(PG_BIN / "pg_dump.exe")) and not (PG_BIN / "pg_dump.exe").exists():
        print("BACKUP_FAIL: pg_dump not found at", PG_BIN)
        return 1
    target = Path(os.environ.get("FINOS_BACKUP_DIR") or (Path.home() / "OneDrive" / "FinancialOS-Backups"))
    target.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = target / f"financial_os-{stamp}.dump"
    r = subprocess.run([str(PG_BIN / "pg_dump.exe"), "-d", db_url(), "-Fc", "-f", str(out)])
    if r.returncode != 0:
        print("BACKUP_FAIL: pg_dump exit", r.returncode)
        return 1
    dumps = sorted(target.glob("financial_os-*.dump"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in dumps[KEEP:]:
        old.unlink()
    print(f"BACKUP_OK: {out} ({out.stat().st_size} bytes, kept {min(len(dumps), KEEP)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
