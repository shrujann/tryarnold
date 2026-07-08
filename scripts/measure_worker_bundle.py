#!/usr/bin/env python3
"""Measure Workers-style vendor package sizes (uncompressed + per-file gzip sum)."""
from __future__ import annotations

import gzip
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULES = ROOT / "python_modules"
LOG = ROOT / ".cursor" / "debug-c72a96.log"


def dir_size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def gzip_size(path: Path) -> int:
    files = [path] if path.is_file() else [f for f in path.rglob("*") if f.is_file()]
    total = 0
    for f in files:
        total += len(gzip.compress(f.read_bytes(), compresslevel=9))
    return total


def main() -> None:
    if not MODULES.exists():
        raise SystemExit(f"missing {MODULES}; run: uv run pywrangler sync")

    rows: list[dict] = []
    for p in MODULES.iterdir():
        if p.name.startswith(".") or p.name.endswith(".dist-info"):
            continue
        raw = dir_size(p)
        gz = gzip_size(p)
        rows.append({"name": p.name, "raw_mb": round(raw / 1024 / 1024, 3), "gzip_mb": round(gz / 1024 / 1024, 3), "raw": raw, "gzip": gz})

    rows.sort(key=lambda r: r["gzip"], reverse=True)
    raw_total = sum(r["raw"] for r in rows)
    gzip_total = sum(r["gzip"] for r in rows)

    print("Top packages by gzip contribution:")
    print(f"{'gzip MB':>8}  {'raw MB':>8}  name")
    for r in rows[:30]:
        print(f"{r['gzip_mb']:8.3f}  {r['raw_mb']:8.3f}  {r['name']}")
    print("---")
    print(f"TOTAL raw  {raw_total/1024/1024:.2f} MB")
    print(f"TOTAL gzip {gzip_total/1024/1024:.2f} MB  (approx Worker after compression)")
    print("Limits: Free 3.00 MB gzip | Paid 10.00 MB gzip")
    print(f"Free headroom: {3 - gzip_total/1024/1024:.2f} MB")
    print(f"Paid headroom: {10 - gzip_total/1024/1024:.2f} MB")

    LOG.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "sessionId": "c72a96",
        "runId": "package-size-probe",
        "hypothesisId": "H5",
        "location": "scripts/measure_worker_bundle.py",
        "message": "worker vendor package size breakdown",
        "data": {
            "raw_total_mb": round(raw_total / 1024 / 1024, 3),
            "gzip_total_mb": round(gzip_total / 1024 / 1024, 3),
            "free_limit_mb": 3,
            "paid_limit_mb": 10,
            "top": rows[:20],
        },
        "timestamp": int(time.time() * 1000),
    }
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload) + "\n")


if __name__ == "__main__":
    main()
