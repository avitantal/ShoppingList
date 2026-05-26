const ils = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatILS(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return ils.format(value);
}

export function formatCompactILS(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `₪${value.toFixed(2)}`;
}

export function normalizeStoreName(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}
