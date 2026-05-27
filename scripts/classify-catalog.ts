// One-off batch classifier for the product catalog.
//
// Reads every row in shopping.products, runs the keyword classifier
// (src/lib/departments.ts) on the product name, and upserts the result
// into shopping.product_departments. Rows with source='manual' are
// skipped so curated overrides survive re-runs.
//
// Usage:
//   npx tsx scripts/classify-catalog.ts
//
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (service role bypasses
// RLS — the table is read-only for normal users).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { classifyItem, DEPARTMENTS } from '../src/lib/departments';

function loadEnv(path: string): Record<string, string> {
  const text = readFileSync(path, 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const env = loadEnv(resolve(process.cwd(), '.env.local'));
const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

interface ProductRow {
  barcode: string;
  name: string;
  manufacturer: string | null;
}

const PAGE_SIZE = 1000;
const UPSERT_BATCH = 500;

async function fetchAllProducts(): Promise<ProductRow[]> {
  const all: ProductRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .schema('shopping')
      .from('products')
      .select('barcode,name,manufacturer')
      .order('barcode', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetch products: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as ProductRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    process.stdout.write(`\rfetched ${all.length} products`);
  }
  process.stdout.write(`\rfetched ${all.length} products\n`);
  return all;
}

async function fetchManualBarcodes(): Promise<Set<string>> {
  const { data, error } = await supabase
    .schema('shopping')
    .from('product_departments')
    .select('barcode')
    .eq('source', 'manual');
  if (error) throw new Error(`fetch manuals: ${error.message}`);
  return new Set((data ?? []).map((r) => r.barcode as string));
}

async function upsertBatch(rows: { barcode: string; department_code: string; source: 'auto' }[]) {
  const { error } = await supabase
    .schema('shopping')
    .from('product_departments')
    .upsert(rows, { onConflict: 'barcode' });
  if (error) throw new Error(`upsert: ${error.message}`);
}

async function main() {
  console.log('classifying catalog...');
  const [products, manual] = await Promise.all([fetchAllProducts(), fetchManualBarcodes()]);
  console.log(`manual overrides to skip: ${manual.size}`);

  const counts = new Map<string, number>();
  for (const d of DEPARTMENTS) counts.set(d.code, 0);

  const pending: { barcode: string; department_code: string; source: 'auto' }[] = [];
  let skipped = 0;

  for (const p of products) {
    if (manual.has(p.barcode)) {
      skipped++;
      continue;
    }
    const text = [p.name, p.manufacturer].filter(Boolean).join(' ');
    const { department } = classifyItem(text);
    counts.set(department, (counts.get(department) ?? 0) + 1);
    pending.push({ barcode: p.barcode, department_code: department, source: 'auto' });
  }

  console.log(`classified ${pending.length} rows (skipped ${skipped} manual)`);

  let upserted = 0;
  for (let i = 0; i < pending.length; i += UPSERT_BATCH) {
    const chunk = pending.slice(i, i + UPSERT_BATCH);
    await upsertBatch(chunk);
    upserted += chunk.length;
    process.stdout.write(`\rupserted ${upserted}/${pending.length}`);
  }
  process.stdout.write(`\rupserted ${upserted}/${pending.length}\n`);

  console.log('\nper-department counts:');
  const total = pending.length;
  for (const d of DEPARTMENTS) {
    const n = counts.get(d.code) ?? 0;
    const pct = total ? ((n / total) * 100).toFixed(1) : '0.0';
    console.log(`  ${d.name.padEnd(18)}  ${String(n).padStart(6)}  (${pct}%)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
