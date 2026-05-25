#!/usr/bin/env python3
"""
Emit JSON-only batches from NDJSON. Each batch is just a JSON array
(no SQL wrapper). The orchestrator wraps these in an UPSERT statement
at apply time. This keeps file size below the Read tool's 25K-token cap.

Usage:
    python scripts/emit_json_batches.py <NDJSON> <BATCH_SIZE> <OUT_DIR>
"""
from __future__ import annotations
import json
import os
import sys


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: emit_json_batches.py <NDJSON> <BATCH_SIZE> <OUT_DIR>", file=sys.stderr)
        return 2

    src, batch_size, out_dir = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    os.makedirs(out_dir, exist_ok=True)

    with open(src, encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]

    n = 0
    for i in range(0, len(rows), batch_size):
        n += 1
        chunk = rows[i:i + batch_size]
        path = os.path.join(out_dir, f"batch_{n:04d}.json")
        with open(path, "w", encoding="utf-8") as o:
            json.dump(chunk, o, ensure_ascii=False, separators=(",", ":"))

    sys.stderr.write(f"wrote {n} batches into {out_dir}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
