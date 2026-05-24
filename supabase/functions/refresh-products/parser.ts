import { XMLParser } from "fast-xml-parser";

export interface RawItem {
  ItemCode?: string | number;
  ItemName?: string;
  ManufacturerName?: string;
  Quantity?: string | number;
  UnitOfMeasure?: string;
  ItemPrice?: string | number;
}

export interface NormalizedRow {
  barcode: string;
  name: string;
  unit_qty: number | null;
  unit_measure: string | null;
  manufacturer: string | null;
  price: number;
}

export type NormalizeResult =
  | { ok: true; row: NormalizedRow }
  | { ok: false; reason: string };

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,        // keep strings; we coerce manually
  trimValues: true,
});

export function parsePriceFull(xml: string): RawItem[] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  // Schema varies slightly across chains; accept Root>Items>Item or Items>Item.
  const root = (doc.Root ?? doc.root ?? doc) as Record<string, unknown>;
  const items = (root.Items ?? (root as Record<string, unknown>).items) as
    | { Item?: RawItem | RawItem[] }
    | undefined;
  if (!items?.Item) return [];
  return Array.isArray(items.Item) ? items.Item : [items.Item];
}

function trimOrEmpty(v: unknown): string {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return "";
  return v.trim();
}

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function toNumberOrNaN(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

export function normalizeRow(raw: RawItem, seen: Set<string>): NormalizeResult {
  const barcode = trimOrEmpty(raw.ItemCode);
  if (!barcode) return { ok: false, reason: "empty barcode" };
  if (seen.has(barcode)) return { ok: false, reason: "duplicate barcode" };

  const nameRaw = trimOrEmpty(raw.ItemName);
  if (!nameRaw) return { ok: false, reason: "empty name" };
  if (/^\d+$/.test(nameRaw)) return { ok: false, reason: "numeric-only name" };

  const price = toNumberOrNaN(raw.ItemPrice);
  if (!(price > 0)) return { ok: false, reason: "price <= 0 or non-numeric" };

  const unitQtyN = toNumberOrNaN(raw.Quantity);
  const manufacturerRaw = trimOrEmpty(raw.ManufacturerName);

  seen.add(barcode);
  return {
    ok: true,
    row: {
      barcode,
      name: collapseSpaces(nameRaw),
      unit_qty: Number.isFinite(unitQtyN) ? unitQtyN : null,
      unit_measure: trimOrEmpty(raw.UnitOfMeasure) || null,
      manufacturer: manufacturerRaw || null,
      price,
    },
  };
}
