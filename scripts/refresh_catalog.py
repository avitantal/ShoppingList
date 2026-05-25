#!/usr/bin/env python3
"""
Refresh shopping.products + shopping.product_prices from each chain's
PriceFull XML feed.

Why Python (and not a Supabase Edge Function): Rami Levy publishes only
via FTP, which Deno's runtime can't reach. il_supermarket_scarper handles
both Shufersal's HTTPS portal and Rami Levy's FTP behind one API.

Runs in GitHub Actions on a daily cron — see
.github/workflows/refresh-catalog.yml. Locally:
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python scripts/refresh_catalog.py
"""

from __future__ import annotations

import glob
import gzip
import os
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Iterator

# Note the typo: PyPI package is "il-supermarket-scraper" (correct), but
# the importable Python module kept the original "scarper" misspelling
# from when the library was first released. Both names are intentional.
from il_supermarket_scarper import ScarpingTask, ScraperFactory  # type: ignore
from supabase import create_client  # type: ignore

# (db chain code, scraper enum name used by il_supermarket_scarper).
# Resolving via ScraperFactory.X.name fails loudly if a future lib release
# renames a scraper (AttributeError at import time, not a quiet 0 results
# from a bad string).
def _scraper_names() -> list[tuple[str, str]]:
    return [
        ("shufersal", ScraperFactory.SHUFERSAL.name),
        ("rami_levy", ScraperFactory.RAMI_LEVY.name),
    ]

BATCH = 500


@dataclass
class Item:
    barcode: str
    name: str
    unit_qty: float | None
    unit_measure: str | None
    manufacturer: str | None
    price: float


def _txt(item: ET.Element, *tags: str) -> str:
    """First non-empty value among the candidate tags, case-insensitive.

    Different chains use different casings and even different spellings:
    Shufersal publishes <ManufactureName> (missing 'r'), the spec calls
    it <ManufacturerName>, Super-Pharm uses <Line> instead of <Item>,
    and lower-cased variants show up too. We normalise once per item
    instead of trying every permutation per field.
    """
    lower_map = {c.tag.lower(): c for c in item}
    for t in tags:
        c = lower_map.get(t.lower())
        if c is not None and c.text is not None:
            v = c.text.strip()
            if v:
                return v
    return ""


def _float(s: str) -> float | None:
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_pricefull(xml_bytes: bytes) -> Iterator[Item]:
    # Root may be <Root>, <Items>, <root>, etc. .iter() walks every element
    # so we don't depend on the wrapper.
    root = ET.fromstring(xml_bytes)
    for el in root.iter():
        # Item element is <Item> on most chains, <Product> on a few,
        # <Line> on Super-Pharm. Check by tag, then by presence of a price.
        if el.tag.lower() not in ("item", "product", "line"):
            continue
        barcode = _txt(el, "ItemCode")
        if not barcode:
            continue
        name = _txt(el, "ItemName", "ManufacturerItemDescription", "ManufactureItemDescription")
        if not name:
            continue
        price = _float(_txt(el, "ItemPrice"))
        if price is None or price < 0:
            continue
        # Shufersal swaps the spec's UnitQty/Quantity meanings: UnitQty
        # holds the unit string ('גרם'), Quantity holds the number.
        # Try the numeric variants in order; the first that parses wins.
        unit_qty = (
            _float(_txt(el, "Quantity"))
            or _float(_txt(el, "UnitQty"))
            or _float(_txt(el, "QtyInPackage"))
        )
        # Manufacturer name has two spellings in the wild:
        # ManufacturerName (spec) and ManufactureName (Shufersal typo).
        manufacturer = (
            _txt(el, "ManufacturerName", "ManufactureName") or None
        )
        yield Item(
            barcode=barcode,
            name=name,
            unit_qty=unit_qty,
            unit_measure=_txt(el, "UnitOfMeasure") or None,
            manufacturer=manufacturer,
            price=price,
        )


def read_gz_or_xml(path: str) -> bytes:
    if path.endswith(".gz"):
        with gzip.open(path, "rb") as f:
            return f.read()
    with open(path, "rb") as f:
        return f.read()


def ingest_one(chain_code: str, scraper_name: str, sb) -> tuple[int, int]:
    print(f"--- {chain_code} (scraper={scraper_name}) ---", flush=True)
    with tempfile.TemporaryDirectory() as out_dir:
        # il-supermarket-scraper 1.x API:
        #   - output_configuration uses key 'base_storage_path' (NOT
        #     'storage_path'); with the wrong key the lib silently falls
        #     back to ./dumps and our glob below misses it.
        #   - status_configuration also writes to disk; redirect both into
        #     our tempdir so we don't pollute CWD with state files.
        #   - .start(limit=1) caps downloads to a single PriceFull file.
        #     One per chain is enough — the product list is identical
        #     across stores and we only persist one price per (barcode,
        #     chain) anyway.
        task = ScarpingTask(
            enabled_scrapers=[scraper_name],
            files_types=["PRICE_FULL_FILE"],
            output_configuration={"output_mode": "disk", "base_storage_path": out_dir},
            status_configuration={"database_type": "json", "base_path": os.path.join(out_dir, "status")},
        )
        task.start(limit=1)
        # start() returns immediately — the scraper runs in a daemon thread.
        # join() blocks until the download finishes; without it we'd glob
        # the storage dir before any files land.
        task.join()

        paths = sorted(
            glob.glob(os.path.join(out_dir, "**", "PriceFull*"), recursive=True)
            + glob.glob(os.path.join(out_dir, "**", "pricefull*"), recursive=True)
        )
        if not paths:
            print(f"WARN: {chain_code}: no PriceFull files found")
            return (0, 0)
        print(f"{chain_code}: {len(paths)} PriceFull file(s)")

        products: dict[str, dict] = {}
        prices: list[dict] = []
        for p in paths:
            try:
                raw = read_gz_or_xml(p)
                for item in parse_pricefull(raw):
                    products[item.barcode] = {
                        "barcode": item.barcode,
                        "name": item.name,
                        "unit_qty": item.unit_qty,
                        "unit_measure": item.unit_measure,
                        "manufacturer": item.manufacturer,
                    }
                    prices.append({
                        "barcode": item.barcode,
                        "chain_code": chain_code,
                        "price": item.price,
                    })
            except Exception as e:
                print(f"ERR parsing {p}: {e}")
                continue

        # Dedupe price rows to one per barcode — last write wins. Multiple
        # store files can have the same barcode at slightly different prices.
        last_price: dict[str, dict] = {row["barcode"]: row for row in prices}

        plist = list(products.values())
        prlist = list(last_price.values())

        print(f"{chain_code}: upserting {len(plist)} products, {len(prlist)} prices")
        for i in range(0, len(plist), BATCH):
            sb.schema("shopping").from_("products").upsert(plist[i:i + BATCH]).execute()
        for i in range(0, len(prlist), BATCH):
            sb.schema("shopping").from_("product_prices").upsert(prlist[i:i + BATCH]).execute()
        return (len(plist), len(prlist))


def main() -> int:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        return 2

    sb = create_client(url, key)
    totals: list[tuple[str, int, int]] = []
    failed: list[str] = []
    for chain_code, scraper_name in _scraper_names():
        try:
            p, pr = ingest_one(chain_code, scraper_name, sb)
            totals.append((chain_code, p, pr))
        except Exception as e:
            print(f"FAIL {chain_code}: {e}")
            failed.append(chain_code)

    print("\nSummary:")
    for c, p, pr in totals:
        print(f"  {c}: products={p} prices={pr}")
    if failed:
        print(f"  failed: {failed}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
