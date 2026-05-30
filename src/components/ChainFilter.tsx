import { Eye, EyeOff } from 'lucide-react';
import { useChainFilter } from '../hooks/useChainFilter';
import { ACTIVE_CHAIN_CODES, CHAIN_BADGE_COLORS } from '../lib/supabase';

const BADGE_FALLBACK = { bg: '#6B7280', fg: '#FFFFFF' };

// Row of chain "chip" toggles. Tapping a chip switches it off (muted
// with an eye-off icon); tapping again switches it back on. State
// is shared and persisted via useChainFilter.
// Chains without prices yet (not in ACTIVE_CHAIN_CODES) appear dimmed.
export function ChainFilter({ className = '' }: { className?: string }) {
  const { chains, excluded, toggle } = useChainFilter();
  if (chains.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {chains.map(c => {
        const off     = excluded.has(c.code);
        const active  = ACTIVE_CHAIN_CODES.has(c.code);
        const color   = CHAIN_BADGE_COLORS[c.code] ?? BADGE_FALLBACK;
        return (
          <button
            key={c.code}
            type="button"
            onClick={() => toggle(c.code)}
            className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 min-h-[44px] rounded-full border transition whitespace-nowrap ${
              off || !active
                ? 'bg-bg text-muted border-border'
                : 'border-transparent'
            } ${!active ? 'opacity-40' : off ? 'opacity-75' : ''}`}
            style={off || !active ? undefined : { backgroundColor: color.bg, color: color.fg }}
            aria-pressed={!off}
            aria-label={`${off ? 'הפעל' : 'הסתר'} ${c.display_name}${!active ? ' (בקרוב)' : ''}`}
            title={!active ? `${c.display_name} — בקרוב` : off ? `הפעל ${c.display_name}` : `הסתר ${c.display_name}`}
          >
            {off ? <EyeOff size={11} /> : <Eye size={11} />}
            {c.display_name}
          </button>
        );
      })}
    </div>
  );
}
