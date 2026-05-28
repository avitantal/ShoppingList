import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ALL_CHAINS = ["shufersal","mega","rami_levy","victory","osher_ad","hazi_hinam","yohananof"];
const STALE_MS   = 14 * 60 * 60 * 1000; // 14h — aligned with twice-daily cron

const RowSchema = z.object({
  barcode:    z.string().min(1),
  item_name:  z.string().min(1),
  price:      z.number().positive(),
  updated_at: z.string(),
});

const IngestSchema = z.object({
  chain_code: z.string().min(1),
  file_name:  z.string().min(1),
  sha256:     z.string().min(1),
  is_final:   z.boolean(),
  rows:       z.array(RowSchema).min(1).max(5000),
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  const key = Deno.env.get("INGEST_KEY");
  if (req.headers.get("Authorization") !== `Bearer ${key}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const path = new URL(req.url).pathname.split("/").pop();

  if (req.method === "POST" && path === "ingest") {
    let body: unknown;
    try { body = await req.json(); }
    catch { return json({ error: "Invalid JSON" }, 400); }

    const parsed = IngestSchema.safeParse(body);
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

    const { chain_code, file_name, sha256, is_final, rows } = parsed.data;
    const { data, error } = await supabase.rpc("ingest_batch", {
      p_chain_code: chain_code,
      p_file_name:  file_name,
      p_sha256:     sha256,
      p_rows:       rows,
      p_is_final:   is_final,
    });
    if (error) { console.error(error); return json({ error: error.message }, 500); }
    return json(data);
  }

  if (req.method === "GET" && path === "health") {
    const { data, error } = await supabase
      .from("refresh_log")
      .select("chain_code, started_at")
      .order("started_at", { ascending: false });

    if (error) return json({ error: error.message }, 500);

    const now = Date.now();
    const latest = new Map<string, number>();
    for (const row of data ?? []) {
      if (!latest.has(row.chain_code))
        latest.set(row.chain_code, new Date(row.started_at).getTime());
    }

    const stale = ALL_CHAINS.filter(c => {
      const t = latest.get(c);
      return !t || (now - t) > STALE_MS;
    });
    const ok = ALL_CHAINS.filter(c => !stale.includes(c));

    return json(
      { stale_chains: stale, ok_chains: ok, checked_at: new Date().toISOString() },
      stale.length > 0 ? 503 : 200
    );
  }

  return json({ error: "Not found" }, 404);
});
