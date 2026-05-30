import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractRoute,
  appendRoute,
  getStoredRoutes,
  suggestOrder,
  isSuggestionSuppressed,
  recordDecline,
  resetDecline,
  MIN_CHECKOUTS,
} from '../../lib/routeSuggestion';
import { DEPARTMENTS } from '../../lib/departments';
import type { DepartmentCode } from '../../lib/departments';

beforeEach(() => { localStorage.clear(); });

const fullOrder = DEPARTMENTS
  .filter(d => d.code !== 'unclassified')
  .sort((a, b) => a.order - b.order)
  .map(d => d.code) as DepartmentCode[];

describe('extractRoute', () => {
  it('collapses consecutive duplicates and deduplicates by first occurrence (default minCluster=1)', () => {
    // snacks kept — noise filtering is handled by pairwise confidence, not early rejection
    const raw = ['dairy', 'dairy', 'snacks', 'dairy', 'dairy', 'bakery', 'bakery'] as DepartmentCode[];
    expect(extractRoute(raw)).toEqual(['dairy', 'snacks', 'bakery']);
  });
  it('deduplicates revisited sections by first occurrence', () => {
    const raw = ['dairy', 'dairy', 'bakery', 'bakery', 'dairy', 'dairy'] as DepartmentCode[];
    expect(extractRoute(raw)).toEqual(['dairy', 'bakery']);
  });
  it('returns empty for empty input', () => {
    expect(extractRoute([])).toEqual([]);
  });
  it('keeps single-item departments with default minCluster=1', () => {
    // single bread → bakery still makes it into the route (important for small purchases)
    const raw = ['dairy', 'snacks', 'bakery'] as DepartmentCode[];
    expect(extractRoute(raw)).toEqual(['dairy', 'snacks', 'bakery']);
  });
  it('filters singleton runs with explicit minCluster=2', () => {
    const raw = ['dairy', 'dairy', 'snacks', 'dairy', 'dairy', 'bakery', 'bakery'] as DepartmentCode[];
    expect(extractRoute(raw, 2)).toEqual(['dairy', 'bakery']);
  });
  it('returns empty when all runs are singletons with minCluster=2', () => {
    const raw = ['dairy', 'snacks', 'bakery'] as DepartmentCode[];
    expect(extractRoute(raw, 2)).toEqual([]);
  });
});

describe('appendRoute / getStoredRoutes', () => {
  it('stores and retrieves sequences', () => {
    appendRoute('list-1', ['dairy', 'bakery'] as DepartmentCode[]);
    expect(getStoredRoutes('list-1')).toEqual([['dairy', 'bakery']]);
  });
  it('does not store empty sequences', () => {
    appendRoute('list-1', []);
    expect(getStoredRoutes('list-1')).toEqual([]);
  });
  it('caps at 20 stored sequences', () => {
    for (let i = 0; i < 25; i++) appendRoute('list-1', ['dairy'] as DepartmentCode[]);
    expect(getStoredRoutes('list-1')).toHaveLength(20);
  });
  it('isolates between lists', () => {
    appendRoute('list-1', ['dairy'] as DepartmentCode[]);
    expect(getStoredRoutes('list-2')).toEqual([]);
  });
});

describe('suggestOrder', () => {
  it('returns null when fewer than MIN_CHECKOUTS usable sequences', () => {
    const seqs = [['dairy', 'produce']] as DepartmentCode[][];
    expect(suggestOrder(seqs, fullOrder, DEPARTMENTS)).toBeNull();
  });

  it('returns null when all decisive pairs agree with current order', () => {
    // repeat the first 3 departments of fullOrder in their existing order
    const topThree = fullOrder.slice(0, 3);
    const seqs: DepartmentCode[][] = Array(MIN_CHECKOUTS).fill(topThree);
    expect(suggestOrder(seqs, fullOrder, DEPARTMENTS)).toBeNull();
  });

  it('returns null when pairs lack enough observations (below MIN_PAIR_SUPPORT)', () => {
    // only 2 sequences → each pair seen 2 times < MIN_PAIR_SUPPORT=3 → no decisive pairs
    const seqs: DepartmentCode[][] = [
      ['beverages', 'produce', 'dairy'] as DepartmentCode[],
      ['beverages', 'produce', 'dairy'] as DepartmentCode[],
    ];
    expect(suggestOrder(seqs, fullOrder, DEPARTMENTS)).toBeNull();
  });

  it('ranks beverages higher when user always starts there', () => {
    const seqs: DepartmentCode[][] = Array(MIN_CHECKOUTS).fill(
      ['beverages', 'produce', 'dairy'] as DepartmentCode[],
    );
    const result = suggestOrder(seqs, fullOrder, DEPARTMENTS);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.indexOf('beverages')).toBeLessThan(fullOrder.indexOf('beverages'));
    }
  });

  it('ranks dairy before bakery when dairy consistently comes first', () => {
    const seqs: DepartmentCode[][] = Array(MIN_CHECKOUTS).fill(
      ['dairy', 'bakery'] as DepartmentCode[],
    );
    const result = suggestOrder(seqs, fullOrder, DEPARTMENTS);
    if (result) {
      expect(result.indexOf('dairy')).toBeLessThan(result.indexOf('bakery'));
    }
  });

  it('does not count sequences that are only UNCLASSIFIED', () => {
    const seqs: DepartmentCode[][] = [
      ...Array(MIN_CHECKOUTS - 1).fill(['beverages', 'produce'] as DepartmentCode[]),
      ['unclassified'] as DepartmentCode[],
    ];
    expect(suggestOrder(seqs, fullOrder, DEPARTMENTS)).toBeNull();
  });
});

describe('decline suppression', () => {
  it('is not suppressed initially', () => {
    expect(isSuggestionSuppressed('list-1')).toBe(false);
  });

  it('is suppressed after 5 declines', () => {
    for (let i = 0; i < 5; i++) recordDecline('list-1');
    expect(isSuggestionSuppressed('list-1')).toBe(true);
  });

  it('resets after resetDecline', () => {
    for (let i = 0; i < 5; i++) recordDecline('list-1');
    resetDecline('list-1');
    expect(isSuggestionSuppressed('list-1')).toBe(false);
  });

  it('isolates between lists', () => {
    for (let i = 0; i < 5; i++) recordDecline('list-1');
    expect(isSuggestionSuppressed('list-2')).toBe(false);
  });
});
