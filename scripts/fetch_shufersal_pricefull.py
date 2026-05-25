#!/usr/bin/env python3
"""
Fetch + parse + normalize one Shufersal PriceFull XML file into newline-delimited JSON.

Usage:
    python scripts/fetch_shufersal_pricefull.py <URL> <OUT_PATH>

Each JSON line:
    {"barcode": "...", "name": "...", "unit_qty": 1.5, "unit_measure": "ליטר", "manufacturer": "תנובה", "price": 6.9}

Rejected rows (blank name/code, price<=0, numeric-only name, duplicates within run)
are reported to stderr with a count summary at the end.

This is the same logic implemented in the deferred-from-PoC Edge Function parser.
Kept here as the entry point for the future phase-3 GitHub Action that will
refresh the catalog daily.
"""
from __future__ import annotations
import gzip
import io
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET


WS_RE = re.compile(r"\s+")
NUM_RE = re.compile(r"^\d+$")


def text(el: ET.Element | None, tag: str) -> str:
    if el is None:
        return ""
    child = el.find(tag)
    if child is None or child.text is None:
        return ""
    return child.text.strip()


def to_number(s: str) -> float | None:
    if not s:
        return None
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return None


def normalize(item: ET.Element, seen: set[str]) -> tuple[bool, dict | str]:
    barcode = text(item, "ItemCode")
    if not barcode:
        return False, "empty barcode"
    if barcode in seen:
        return False, "duplicate"

    name_raw = text(item, "ItemName")
    if not name_raw:
        return False, "empty name"
    if NUM_RE.match(name_raw):
        return False, "numeric-only name"

    price = to_number(text(item, "ItemPrice"))
    if price is None or price <= 0:
        return False, "price<=0 or non-numeric"

    unit_qty = to_number(text(item, "Quantity"))
    manufacturer = text(item, "ManufacturerName")

    seen.add(barcode)
    return True, {
        "barcode": barcode,
        "name": WS_RE.sub(" ", name_raw).strip(),
        "unit_qty": unit_qty,
        "unit_measure": text(item, "UnitOfMeasure") or None,
        "manufacturer": manufacturer or None,
        "price": price,
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: fetch_shufersal_pricefull.py <URL> <OUT_PATH>", file=sys.stderr)
        return 2

    url, out_path = sys.argv[1], sys.argv[2]

    sys.stderr.write(f"fetching {url[:80]}...\n")
    with urllib.request.urlopen(url, timeout=120) as resp:
        body = resp.read()
    sys.stderr.write(f"  downloaded {len(body):,} bytes\n")

    xml_bytes = gzip.decompress(body)
    sys.stderr.write(f"  decompressed to {len(xml_bytes):,} bytes\n")

    seen: set[str] = set()
    kept = 0
    skipped: dict[str, int] = {}

    with open(out_path, "w", encoding="utf-8") as out:
        for _, item in ET.iterparse(io.BytesIO(xml_bytes), events=("end",)):
            if item.tag != "Item":
                continue
            ok, payload = normalize(item, seen)
            if ok:
                out.write(json.dumps(payload, ensure_ascii=False) + "\n")
                kept += 1
            else:
                skipped[payload] = skipped.get(payload, 0) + 1
            item.clear()

    sys.stderr.write(f"kept {kept:,} rows -> {out_path}\n")
    for reason, n in sorted(skipped.items(), key=lambda kv: -kv[1]):
        sys.stderr.write(f"  skipped {n:>6,}  ({reason})\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
