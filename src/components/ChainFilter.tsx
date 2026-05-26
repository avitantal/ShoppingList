import { Eye, EyeOff } from 'lucide-react';
import { useChainFilter } from '../hooks/useChainFilter';
import { CHAIN_BADGE_COLORS } from '../lib/supabase';

const BADGE_FALLBACK = { bg: '#6B7280', fg: '#FFFFFF' };

// Row of chain "chip" toggles. Tapping a chip switches it off (muted
// with an eye-off icon); tapping again switches it back on. State
// is shared and persisted via useChainFilter.
export function ChainFilter({ className = '' }: { className?: string }) {
  const { chains, excluded, toggle } = useChainFilter();
  if (chains.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {chains.map(c => {
        const off = excluded.has(c.code);
        const color = CHAIN_BADGE_COLORS[c.code] ?? BADGE_FALLBACK;
        return (
          <button
            key={c.code}
            type="button"
            onClick={() => toggle(c.code)}
            className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-full border transition whitespace-nowrap ${
              off
                ? 'bg-bg text-muted border-border opacity-75'
                : 'border-transparent'
            }`}
            style={off ? undefined : { backgroundColor: color.bg, color: color.fg }}
            aria-pressed={!off}
            aria-label={`${off ? 'הפעל' : 'הסתר'} ${c.display_name}`}
            title={off ? `הפעל ${c.display_name}` : `הסתר ${c.display_name}`}
          >
            {off ? <EyeOff size={11} /> : <Eye size={11} />}
            {c.display_name}
          </button>
        );
      })}
    </div>
  );
}
