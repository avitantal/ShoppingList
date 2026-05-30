import {
  DEPARTMENTS, DEPARTMENT_CODES,
  type DepartmentCode, type DepartmentMeta,
} from './departments';

export const MIN_CHECKOUTS  = 3;
const MAX_STORED            = 20;
const MAX_DECLINES          = 5;
const SUPPRESS_MS           = 14 * 24 * 60 * 60 * 1000;
const MIN_PAIR_SUPPORT      = 3;
const MIN_PAIR_CONFIDENCE   = 0.67;
const MIN_CHANGED_PAIRS     = 2;

const ROUTE_KEY   = (listId: string) => `routeHistory:${listId}`;
const DECLINE_KEY = (listId: string) => `routeDeclines:${listId}`;

// ── Sequence ──────────────────────────────────────────────────────────────────

/**
 * Groups raw check-off codes into consecutive runs, drops runs shorter than
 * minCluster, then deduplicates by first occurrence so a revisited section
 * doesn't shift its original position.
 *
 * Default minCluster=1 keeps single-item departments; pairwise confidence
 * handles the noise instead of early rejection.
 */
export function extractRoute(raw: DepartmentCode[], minCluster = 1): DepartmentCode[] {
  const runs: { code: DepartmentCode; count: number }[] = [];
  for (const code of raw) {
    const last = runs.at(-1);
    if (last?.code === code) last.count++;
    else runs.push({ code, count: 1 });
  }
  return runs
    .filter(r => r.count >= minCluster)
    .map(r => r.code)
    .filter((c, i, arr) => arr.indexOf(c) === i);
}

// ── localStorage ──────────────────────────────────────────────────────────────

export function getStoredRoutes(listId: string): DepartmentCode[][] {
  try {
    const raw = localStorage.getItem(ROUTE_KEY(listId));
    return raw ? (JSON.parse(raw) as DepartmentCode[][]) : [];
  } catch { return []; }
}

export function appendRoute(listId: string, sequence: DepartmentCode[]): void {
  if (sequence.length === 0) return;
  try {
    const stored = getStoredRoutes(listId);
    localStorage.setItem(
      ROUTE_KEY(listId),
      JSON.stringify([...stored, sequence].slice(-MAX_STORED)),
    );
  } catch {}
}

// ── Decline suppression ───────────────────────────────────────────────────────

interface DeclineState { count: number; suppressedUntil: number; }

function getDeclineState(listId: string): DeclineState {
  try {
    const raw = localStorage.getItem(DECLINE_KEY(listId));
    if (!raw) return { count: 0, suppressedUntil: 0 };
    const p = JSON.parse(raw);
    const count = Number.isFinite(p?.count) ? p.count : 0;
    const suppressedUntil = Number.isFinite(p?.suppressedUntil) ? p.suppressedUntil : 0;
    if (count >= MAX_DECLINES && suppressedUntil > 0 && Date.now() >= suppressedUntil) {
      localStorage.removeItem(DECLINE_KEY(listId));
      return { count: 0, suppressedUntil: 0 };
    }
    return { count, suppressedUntil };
  } catch { return { count: 0, suppressedUntil: 0 }; }
}

export function isSuggestionSuppressed(listId: string): boolean {
  const { count, suppressedUntil } = getDeclineState(listId);
  return count >= MAX_DECLINES && Date.now() < suppressedUntil;
}

export function recordDecline(listId: string): void {
  const { count } = getDeclineState(listId);
  const newCount = count + 1;
  localStorage.setItem(DECLINE_KEY(listId), JSON.stringify({
    count: newCount,
    suppressedUntil: newCount >= MAX_DECLINES ? Date.now() + SUPPRESS_MS : 0,
  }));
}

export function resetDecline(listId: string): void {
  localStorage.removeItem(DECLINE_KEY(listId));
}

// ── Pairwise / Copeland ───────────────────────────────────────────────────────

function buildPairStats(
  sequences: DepartmentCode[][],
): Map<string, { aFirst: number; bFirst: number }> {
  const stats = new Map<string, { aFirst: number; bFirst: number }>();
  for (const seq of sequences) {
    const unique = seq.filter((c, i) => seq.indexOf(c) === i);
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const earlier = unique[i], later = unique[j];
        // Canonical key: alphabetically-earlier code first so each pair has one key.
        const [a, b] = earlier < later
          ? [earlier, later] as [DepartmentCode, DepartmentCode]
          : [later, earlier] as [DepartmentCode, DepartmentCode];
        const key = `${a}|${b}`;
        const cur = stats.get(key) ?? { aFirst: 0, bFirst: 0 };
        if (earlier === a) stats.set(key, { ...cur, aFirst: cur.aFirst + 1 });
        else               stats.set(key, { ...cur, bFirst: cur.bFirst + 1 });
      }
    }
  }
  return stats;
}

function copelandScores(
  departments: DepartmentCode[],
  stats: Map<string, { aFirst: number; bFirst: number }>,
): Map<DepartmentCode, number> {
  const scores = new Map<DepartmentCode, number>(departments.map(d => [d, 0]));
  for (const [key, { aFirst, bFirst }] of stats) {
    const [a, b] = key.split('|') as [DepartmentCode, DepartmentCode];
    if (!scores.has(a) || !scores.has(b)) continue;
    const total = aFirst + bFirst;
    if (total < MIN_PAIR_SUPPORT) continue;
    const aRate = aFirst / total;
    if (aRate >= MIN_PAIR_CONFIDENCE) {
      scores.set(a, scores.get(a)! + 1);
      scores.set(b, scores.get(b)! - 1);
    } else if (aRate <= 1 - MIN_PAIR_CONFIDENCE) {
      scores.set(a, scores.get(a)! - 1);
      scores.set(b, scores.get(b)! + 1);
    }
  }
  return scores;
}

export function suggestOrder(
  sequences: DepartmentCode[][],
  currentOrder: DepartmentCode[],
  defaults: DepartmentMeta[] = DEPARTMENTS,
): DepartmentCode[] | null {
  // Strip UNCLASSIFIED and deduplicate within each sequence; drop sequences that become empty.
  const usable = sequences
    .map(seq =>
      seq
        .filter(code => code !== DEPARTMENT_CODES.UNCLASSIFIED)
        .filter((code, i, arr) => arr.indexOf(code) === i),
    )
    .filter(seq => seq.length > 0);

  if (usable.length < MIN_CHECKOUTS) return null;

  const pairStats   = buildPairStats(usable);
  const observedSet = new Set<DepartmentCode>(usable.flat());
  const observed    = [...observedSet];
  const scores      = copelandScores(observed, pairStats);

  // Sort observed departments by Copeland score; tiebreak by default order.
  const defaultIdx = new Map(defaults.map((d, i) => [d.code as DepartmentCode, i]));
  const sortedObserved = [...scores.keys()].sort((a, b) => {
    const diff = scores.get(b)! - scores.get(a)!;
    if (diff !== 0) return diff;
    return (defaultIdx.get(a) ?? 99) - (defaultIdx.get(b) ?? 99);
  });

  const unobserved = defaults
    .filter(d => d.code !== DEPARTMENT_CODES.UNCLASSIFIED && !observedSet.has(d.code as DepartmentCode))
    .sort((a, b) => a.order - b.order)
    .map(d => d.code as DepartmentCode);

  const suggested = [...sortedObserved, ...unobserved];

  // Count decisive pairs that disagree with the current order.
  const currentIdx = new Map<DepartmentCode, number>();
  defaults.forEach((d, i) => {
    const idx = currentOrder.indexOf(d.code as DepartmentCode);
    currentIdx.set(d.code as DepartmentCode, idx >= 0 ? idx : i);
  });

  let changedPairs = 0;
  for (const [key, { aFirst, bFirst }] of pairStats) {
    const total = aFirst + bFirst;
    if (total < MIN_PAIR_SUPPORT) continue;
    const aRate = aFirst / total;
    if (aRate < MIN_PAIR_CONFIDENCE && aRate > 1 - MIN_PAIR_CONFIDENCE) continue;
    const [a, b]        = key.split('|') as [DepartmentCode, DepartmentCode];
    const decisiveFirst = aRate >= MIN_PAIR_CONFIDENCE ? a : b;
    const curA          = currentIdx.get(a) ?? 99;
    const curB          = currentIdx.get(b) ?? 99;
    const currentFirst  = curA < curB ? a : b;
    if (decisiveFirst !== currentFirst) changedPairs++;
  }

  return changedPairs >= MIN_CHANGED_PAIRS ? suggested : null;
}
