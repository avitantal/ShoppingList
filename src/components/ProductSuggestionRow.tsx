import { Star } from 'lucide-react';
import type { MouseEvent } from 'react';
import { CHAIN_BADGE_COLORS, type SearchProductResult } from '../lib/supabase';
import { formatCompactILS } from '../lib/format';
import { cn } from '../lib/utils';

const BADGE_FALLBACK = { bg: '#6B7280', fg: '#FFFFFF' };

function formatPackageSize(qty: number | null, measure: string | null): string {
  if (qty == null || !measure) return '';
  const unitWord = measure.replace(/^\s*\d+(\.\d+)?\s*/, '').trim();
  if (!unitWord) return '';
  return `${qty} ${unitWord}`;
}

export function productSuggestionKey(product: SearchProductResult): string {
  return `${product.chain_code}:${product.barcode}`;
}

export function getCheapestProductKeys(results: SearchProductResult[]): Set<string> {
  const byBarcode = new Map<string, { count: number; min: number }>();
  for (const product of results) {
    const current = byBarcode.get(product.barcode);
    if (!current) byBarcode.set(product.barcode, { count: 1, min: product.price });
    else byBarcode.set(product.barcode, { count: current.count + 1, min: Math.min(current.min, product.price) });
  }

  const keys = new Set<string>();
  for (const product of results) {
    const group = byBarcode.get(product.barcode);
    if (group && group.count > 1 && product.price <= group.min + 0.001) {
      keys.add(productSuggestionKey(product));
    }
  }
  return keys;
}

interface Props {
  product: SearchProductResult;
  highlighted?: boolean;
  cheapest?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseDown?: (event: MouseEvent<HTMLLIElement>) => void;
}

export function ProductSuggestionRow({
  product,
  highlighted = false,
  cheapest = false,
  onClick,
  onMouseEnter,
  onMouseDown,
}: Props) {
  const badge = CHAIN_BADGE_COLORS[product.chain_code] ?? BADGE_FALLBACK;
  const packageSize = formatPackageSize(product.unit_qty, product.unit_measure);

  return (
    <li
      role="option"
      aria-selected={highlighted}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseDown={onMouseDown}
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5 cursor-pointer text-sm border-b border-border last:border-b-0',
        'transition-colors hover:bg-bg',
        highlighted && 'bg-bg',
        cheapest && 'bg-emerald-500/5',
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-semibold text-text min-w-0">
          {product.previously_bought && (
            <Star size={12} className="shrink-0 text-amber-400 fill-amber-400" aria-label="נקנה בעבר" />
          )}
          <span className="truncate">{product.name}</span>
        </div>
        {product.manufacturer && (
          <div className="text-xs text-text/80 font-medium truncate mt-0.5">
            {product.manufacturer}
          </div>
        )}
        <div className="text-xs text-muted truncate mt-0.5">
          {packageSize || 'גודל לא ידוע'}
          {product.previously_bought ? ' · נקנה בעבר' : ''}
        </div>
      </div>

      <div className="shrink-0 min-w-[4.75rem] flex flex-col items-start gap-1">
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded"
          style={{ backgroundColor: badge.bg, color: badge.fg }}
        >
          {product.chain_display_name}
        </span>
        <span className="text-base font-bold tabular-nums text-text [direction:ltr]">
          {formatCompactILS(product.price)}
        </span>
        {cheapest && (
          <span className="text-[10px] leading-4 px-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 font-bold">
            הכי זול
          </span>
        )}
      </div>
    </li>
  );
}
