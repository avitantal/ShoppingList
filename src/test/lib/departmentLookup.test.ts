import { describe, expect, it } from 'vitest';
import {
  getDepartmentForItem,
  groupByDepartment,
  type CatalogIndex,
} from '../../lib/departmentLookup';
import { DEPARTMENT_CODES } from '../../lib/departments';
import type { ListItem } from '../../lib/supabase';

function item(over: Partial<ListItem> = {}): ListItem {
  return {
    id: 'x',
    list_id: 'l',
    name: 'x',
    qty: 1,
    unit: null,
    notes: null,
    estimated_price: null,
    is_in_cart: false,
    sort_order: 0,
    created_by: null,
    last_purchased_at: null,
    barcode: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

describe('getDepartmentForItem', () => {
  it('uses catalog entry when barcode matches', () => {
    const catalog: CatalogIndex = new Map([['7290000000001', DEPARTMENT_CODES.DAIRY]]);
    const it = item({ name: 'משהו שלא נראה כמו חלב', barcode: '7290000000001' });
    expect(getDepartmentForItem(it, catalog)).toBe(DEPARTMENT_CODES.DAIRY);
  });

  it('catalog entry wins over name-based classification', () => {
    // Item has name that would classify as DAIRY by keyword, but catalog says SNACKS.
    // Catalog source-of-truth (presumably a manual override) must win.
    const catalog: CatalogIndex = new Map([['7290000000002', DEPARTMENT_CODES.SNACKS]]);
    const it = item({ name: 'חלב שוקולד מילקה', barcode: '7290000000002' });
    expect(getDepartmentForItem(it, catalog)).toBe(DEPARTMENT_CODES.SNACKS);
  });

  it('falls back to name classifier when barcode is missing', () => {
    const it = item({ name: 'בננה', barcode: null });
    expect(getDepartmentForItem(it, new Map())).toBe(DEPARTMENT_CODES.PRODUCE);
  });

  it('falls back to name classifier when barcode is present but absent from catalog', () => {
    const it = item({ name: 'חלב תנובה', barcode: '9999999999999' });
    expect(getDepartmentForItem(it, new Map())).toBe(DEPARTMENT_CODES.DAIRY);
  });

  it('returns unclassified for empty name and no catalog hit', () => {
    const it = item({ name: '', barcode: null });
    expect(getDepartmentForItem(it, new Map())).toBe(DEPARTMENT_CODES.UNCLASSIFIED);
  });
});

describe('groupByDepartment', () => {
  it('groups items by their resolved department, preserving item order within groups', () => {
    const items = [
      item({ id: 'a', name: 'בננה' }),
      item({ id: 'b', name: 'חלב' }),
      item({ id: 'c', name: 'עגבניות' }),
      item({ id: 'd', name: 'יוגורט' }),
    ];
    const groups = groupByDepartment(items, new Map());
    const byCode = Object.fromEntries(groups.map((g) => [g.department.code, g.items.map((i) => i.id)]));
    expect(byCode[DEPARTMENT_CODES.PRODUCE]).toEqual(['a', 'c']);
    expect(byCode[DEPARTMENT_CODES.DAIRY]).toEqual(['b', 'd']);
  });

  it('returns only non-empty groups', () => {
    const items = [item({ id: 'a', name: 'בננה' })];
    const groups = groupByDepartment(items, new Map());
    expect(groups).toHaveLength(1);
    expect(groups[0].department.code).toBe(DEPARTMENT_CODES.PRODUCE);
  });

  it('orders groups by department.order, with unclassified last', () => {
    const items = [
      item({ id: 'cleaner', name: 'אקונומיקה' }),  // cleaning, order 11
      item({ id: 'banana', name: 'בננה' }),         // produce, order 1
      item({ id: 'unknown', name: 'מטאטא' }),       // ... cleaning (we have a rule), let's use something truly unknown
      item({ id: 'mystery', name: 'xyz123' }),      // unclassified, order 99
      item({ id: 'milk', name: 'חלב' }),            // dairy, order 3
    ];
    const groups = groupByDepartment(items, new Map());
    const codes = groups.map((g) => g.department.code);
    // Produce (1) → Dairy (3) → Cleaning (11) → Unclassified (99)
    expect(codes[0]).toBe(DEPARTMENT_CODES.PRODUCE);
    expect(codes[1]).toBe(DEPARTMENT_CODES.DAIRY);
    expect(codes[codes.length - 1]).toBe(DEPARTMENT_CODES.UNCLASSIFIED);
  });

  it('honors a user-supplied department order', () => {
    const items = [
      item({ id: 'a', name: 'בננה' }),  // produce
      item({ id: 'b', name: 'חלב' }),    // dairy
    ];
    // User shops dairy before produce.
    const userOrder = new Map([
      [DEPARTMENT_CODES.DAIRY, 1],
      [DEPARTMENT_CODES.PRODUCE, 2],
    ]);
    const groups = groupByDepartment(items, new Map(), userOrder);
    expect(groups[0].department.code).toBe(DEPARTMENT_CODES.DAIRY);
    expect(groups[1].department.code).toBe(DEPARTMENT_CODES.PRODUCE);
  });

  it('keeps unclassified at the end even when user order is supplied', () => {
    const items = [
      item({ id: 'a', name: 'xyz123' }),
      item({ id: 'b', name: 'חלב' }),
    ];
    const userOrder = new Map([[DEPARTMENT_CODES.DAIRY, 50]]);
    const groups = groupByDepartment(items, new Map(), userOrder);
    expect(groups[groups.length - 1].department.code).toBe(DEPARTMENT_CODES.UNCLASSIFIED);
  });
});
