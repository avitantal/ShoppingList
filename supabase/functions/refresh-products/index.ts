import { createClient } from "supabase-js";
import { parsePriceFull, normalizeRow, type NormalizedRow } from "./parser.ts";

// Hard-coded chain catalog for the PoC; replace with a DB lookup when adding
// more chains.
const CHAINS: Record<string, { indexUrl: string }> = {
  "rami-levy": {
    // The chain publishes a directory index; we resolve the latest PriceFull
    // file at runtime.
    indexUrl: "https://prices.rami-levy.co.il/",
  },
};

const BATCH_SIZE = 1000;

interface Body {
  log_id?: number;
  chain_code?: string;
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const body: Body = await req.json().catch(() => ({}));
  const chainCode = body.chain_code ?? "rami-levy";
  const cfg = CHAINS[chainCode];
  if (!cfg) return json({ error: `unknown chain ${chainCode}` }, 400);

  // 1. Open / reuse refresh_log row
  let logId = body.log_id;
  if (!logId) {
    const { data, error } = await supabase
      .schema("shopping")
      .from("refresh_log")
      .insert({ chain_code: chainCode, triggered_by: "cron" })
      .select("id")
      .single();
    if (error) return json({ error: error.message }, 500);
    logId = data.id;
  }

  try {
    // 2. Resolve + fetch the latest PriceFull
    const xmlText = await fetchLatestPriceFull(cfg.indexUrl);

    // 3. Parse + normalize
    const raw = parsePriceFull(xmlText);
    const seen = new Set<string>();
    let skipped = 0;
    const good: NormalizedRow[] = [];
    for (const r of raw) {
      const n = normalizeRow(r, seen);
      if (!n.ok) { skipped++; continue; }
      good.push(n.row);
    }

    // 4. Upsert in batches
    let upserted = 0;
    for (let i = 0; i < good.length; i += BATCH_SIZE) {
      const chunk = good.slice(i, i + BATCH_SIZE);

      const { error: pErr } = await supabase
        .schema("shopping")
        .from("products")
        .upsert(
          chunk.map((r) => ({
            barcode: r.barcode,
            name: r.name,
            unit_qty: r.unit_qty,
            unit_measure: r.unit_measure,
            manufacturer: r.manufacturer,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "barcode" },
        );
      if (pErr) throw pErr;

      const { error: ppErr } = await supabase
        .schema("shopping")
        .from("product_prices")
        .upsert(
          chunk.map((r) => ({
            barcode: r.barcode,
            chain_code: chainCode,
            price: r.price,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "barcode,chain_code" },
        );
      if (ppErr) throw ppErr;

      upserted += chunk.length;
    }

    // 5. Finish
    await supabase
      .schema("shopping")
      .from("refresh_log")
      .update({
        finished_at: new Date().toISOString(),
        rows_upserted: upserted,
        rows_skipped: skipped,
      })
      .eq("id", logId);

    return json({ log_id: logId, rows_upserted: upserted, rows_skipped: skipped });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .schema("shopping")
      .from("refresh_log")
      .update({ finished_at: new Date().toISOString(), error: msg })
      .eq("id", logId);
    return json({ log_id: logId, error: msg }, 500);
  }
});

async function fetchLatestPriceFull(indexUrl: string): Promise<string> {
  // Step 1: list files from the index. Rami Levy publishes a JSON-ish HTML
  // page; we grep for the most recent PriceFull-*.gz href.
  const indexHtml = await (await fetch(indexUrl, { redirect: "follow" })).text();
  const match = indexHtml.match(/href="(PriceFull[^"]+\.gz)"/i);
  if (!match) throw new Error("PriceFull file not found in index");
  const fileUrl = new URL(match[1], indexUrl).toString();

  // Step 2: download + gunzip
  const resp = await fetch(fileUrl, { redirect: "follow" });
  if (!resp.ok || !resp.body) throw new Error(`fetch ${fileUrl} -> ${resp.status}`);
  const decompressed = resp.body.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(decompressed).text();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
