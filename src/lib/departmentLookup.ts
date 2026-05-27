// Resolves a list item to a department, and groups a list of items by department.
//
// Precedence:
//   1. If the item has a barcode and the barcode appears in the catalog index
//      (rows from shopping.product_departments), use that — including manual
//      overrides.
//   2. Otherwise, run the keyword classifier on the item name.
//   3. Otherwise (empty name and no catalog hit), unclassified.

import {
  DEPARTMENTS,
  DEPARTMENT_BY_CODE,
  DEPARTMENT_CODES,
  classifyToDepartmentCode,
  normalizeItemName,
  type DepartmentCode,
  type DepartmentMeta,
} from './departments';
import type { ListItem } from './supabase';

export type CatalogIndex = Map<string, DepartmentCode>;
/** Free-text overrides keyed by normalizeItemName(name). Used for items
 *  without a barcode (the catalog table can only key off barcodes). */
export type NameOverrides = Map<string, DepartmentCode>;

export interface DepartmentGroup {
  department: DepartmentMeta;
  items: ListItem[];
}

export function getDepartmentForItem(
  item: Pick<ListItem, 'name' | 'barcode'>,
  catalog: CatalogIndex,
  nameOverrides?: NameOverrides,
): DepartmentCode {
  if (item.barcode) {
    const hit = catalog.get(item.barcode);
    if (hit) return hit;
  } else if (nameOverrides) {
    const hit = nameOverrides.get(normalizeItemName(item.name));
    if (hit) return hit;
  }
  return classifyToDepartmentCode(item.name);
}

export function groupByDepartment(
  items: ListItem[],
  catalog: CatalogIndex,
  userOrder?: Map<DepartmentCode, number>,
  nameOverrides?: NameOverrides,
): DepartmentGroup[] {
  const buckets = new Map<DepartmentCode, ListItem[]>();
  for (const item of items) {
    const code = getDepartmentForItem(item, catalog, nameOverrides);
    const arr = buckets.get(code);
    if (arr) arr.push(item);
    else buckets.set(code, [item]);
  }

  const groups: DepartmentGroup[] = [];
  for (const [code, groupItems] of buckets) {
    const meta = DEPARTMENT_BY_CODE[code];
    if (!meta) continue;
    groups.push({ department: meta, items: groupItems });
  }

  groups.sort((a, b) => {
    // Unclassified always last, even with a user order.
    if (a.department.code === DEPARTMENT_CODES.UNCLASSIFIED) return 1;
    if (b.department.code === DEPARTMENT_CODES.UNCLASSIFIED) return -1;
    const ao = userOrder?.get(a.department.code) ?? a.department.order;
    const bo = userOrder?.get(b.department.code) ?? b.department.order;
    return ao - bo;
  });

  return groups;
}

// Type export used by tests, kept here so the surface is one file.
export type { DepartmentCode, DepartmentMeta };
export { DEPARTMENTS, DEPARTMENT_CODES, DEPARTMENT_BY_CODE };
