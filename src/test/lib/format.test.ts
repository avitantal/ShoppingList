import { describe, it, expect } from 'vitest';
import { formatILS, normalizeStoreName } from '../../lib/format';

describe('formatILS', () => {
  it('formats integer shekels', () => {
    expect(formatILS(10)).toMatch(/10\.00.*₪|₪.*10\.00/);
  });
  it('formats decimals to two places', () => {
    expect(formatILS(6.9)).toMatch(/6\.90/);
  });
  it('returns dash for null/undefined', () => {
    expect(formatILS(null)).toBe('—');
    expect(formatILS(undefined)).toBe('—');
  });
});

describe('normalizeStoreName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeStoreName('  שופרסל   דיל  ')).toBe('שופרסל דיל');
  });
  it('returns empty string unchanged shape for empty input', () => {
    expect(normalizeStoreName('   ')).toBe('');
  });
});
