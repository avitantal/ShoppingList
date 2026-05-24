import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parsePriceFull, normalizeRow, type RawItem } from "./parser.ts";

const FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<Root>
  <Items>
    <Item>
      <ItemCode>7290000000001</ItemCode>
      <ItemName>חלב תנובה 3% בקרטון  1 ליטר</ItemName>
      <ManufacturerName>תנובה</ManufacturerName>
      <Quantity>1</Quantity>
      <UnitOfMeasure>ליטר</UnitOfMeasure>
      <ItemPrice>6.90</ItemPrice>
    </Item>
    <Item>
      <ItemCode>7290000000002</ItemCode>
      <ItemName></ItemName>
      <ItemPrice>5.00</ItemPrice>
    </Item>
    <Item>
      <ItemCode></ItemCode>
      <ItemName>אין-ברקוד</ItemName>
      <ItemPrice>5.00</ItemPrice>
    </Item>
    <Item>
      <ItemCode>7290000000004</ItemCode>
      <ItemName>חינם</ItemName>
      <ItemPrice>0</ItemPrice>
    </Item>
    <Item>
      <ItemCode>7290000000001</ItemCode>
      <ItemName>חלב כפול</ItemName>
      <ItemPrice>7.00</ItemPrice>
    </Item>
  </Items>
</Root>`;

Deno.test("parsePriceFull returns one entry per <Item>", () => {
  const raw = parsePriceFull(FIXTURE);
  assertEquals(raw.length, 5);
});

Deno.test("normalizeRow keeps a good row", () => {
  const raw: RawItem = {
    ItemCode: "7290000000001",
    ItemName: "חלב תנובה 3% בקרטון  1 ליטר",
    ManufacturerName: "תנובה",
    Quantity: "1",
    UnitOfMeasure: "ליטר",
    ItemPrice: "6.90",
  };
  const r = normalizeRow(raw, new Set());
  if (!r.ok) throw new Error("expected ok");
  assertEquals(r.row.barcode, "7290000000001");
  assertEquals(r.row.name, "חלב תנובה 3% בקרטון 1 ליטר"); // collapsed double space
  assertEquals(r.row.price, 6.9);
  assertEquals(r.row.unit_qty, 1);
  assertEquals(r.row.unit_measure, "ליטר");
});

Deno.test("normalizeRow rejects blank ItemName", () => {
  const r = normalizeRow({ ItemCode: "1", ItemName: "", ItemPrice: "5" }, new Set());
  assertEquals(r.ok, false);
});

Deno.test("normalizeRow rejects empty ItemCode", () => {
  const r = normalizeRow({ ItemCode: "", ItemName: "x", ItemPrice: "5" }, new Set());
  assertEquals(r.ok, false);
});

Deno.test("normalizeRow rejects price <= 0", () => {
  const r = normalizeRow({ ItemCode: "1", ItemName: "x", ItemPrice: "0" }, new Set());
  assertEquals(r.ok, false);
  const r2 = normalizeRow({ ItemCode: "1", ItemName: "x", ItemPrice: "not-a-number" }, new Set());
  assertEquals(r2.ok, false);
});

Deno.test("normalizeRow rejects purely numeric name", () => {
  const r = normalizeRow({ ItemCode: "1", ItemName: "12345", ItemPrice: "5" }, new Set());
  assertEquals(r.ok, false);
});

Deno.test("normalizeRow rejects duplicate barcode within run", () => {
  const seen = new Set<string>();
  const a = normalizeRow({ ItemCode: "1", ItemName: "x", ItemPrice: "5" }, seen);
  assertEquals(a.ok, true);
  const b = normalizeRow({ ItemCode: "1", ItemName: "y", ItemPrice: "5" }, seen);
  assertEquals(b.ok, false);
});

Deno.test("normalizeRow coerces blank manufacturer to null", () => {
  const r = normalizeRow({ ItemCode: "1", ItemName: "x", ItemPrice: "5", ManufacturerName: "  " }, new Set());
  if (!r.ok) throw new Error("expected ok");
  assertEquals(r.row.manufacturer, null);
});
