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

from il_supermarket_scarper import ScarpingTask  # type: ignore
from supabase import create_client  # type: ignore

# (db chain code, scraper enum name used by il_supermarket_scarper)
CHAINS: list[tuple[str, str]] = [
    ("shufersal", "SHUFERSAL"),
    ("rami_levy", "RAMI_LEVY"),
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
    """First non-empty value among the candidate tags. Spec uses both
    PascalCase and lower_case_with_underscores across chains."""
    for t in tags:
        v = item.findtext(t)
        if v is not None:
            v = v.strip()
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
    # Some files wrap in <Root>, others in <Items>; .iter handles both.
    root = ET.fromstring(xml_bytes)
    for el in root.iter():
        # Item elements may be <Item> or <Product>; check by presence of an
        # ItemCode/PriceUpdateDate child.
        if el.tag.lower() not in ("item", "product"):
            continue
        barcode = _txt(el, "ItemCode", "itemcode")
        if not barcode:
            continue
        name = _txt(el, "ItemName", "itemname", "ManufacturerItemDescription")
        if not name:
            continue
        price_str = _txt(el, "ItemPrice", "itemprice")
        price = _float(price_str)
        if price is None or price < 0:
            continue
        yield Item(
            barcode=barcode,
            name=name,
            unit_qty=_float(_txt(el, "UnitQty", "unitqty", "Quantity")),
            unit_measure=_txt(el, "UnitOfMeasure", "unitofmeasure") or None,
            manufacturer=_txt(el, "ManufacturerName", "manufacturername") or None,
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
        ScarpingTask(
            dump_folder=out_dir,
            only_latest=True,
            files_types=["PRICE_FULL_FILE"],
            enabled_scrapers=[scraper_name],
        ).start()

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
    for chain_code, scraper_name in CHAINS:
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
