import { useEffect, useRef } from 'react';
import { DEPARTMENTS } from '../lib/departments';
import type { DepartmentCode } from '../lib/departments';

interface Props {
  suggested: DepartmentCode[];
  onAccept: () => void;
  onDecline: () => void;
  onDismiss: () => void;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function RouteSuggestionDialog({ suggested, onAccept, onDecline, onDismiss }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    // Move focus into the dialog on open
    const first = el.querySelectorAll<HTMLElement>(FOCUSABLE)[0];
    first?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onDismiss(); return; }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(el!.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const labelMap = Object.fromEntries(DEPARTMENTS.map(d => [d.code, d]));

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-2">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="route-dialog-title"
        className="card w-full max-w-sm p-4"
      >
        <h2 id="route-dialog-title" className="text-base font-semibold mb-1">סדר מחלקות חדש?</h2>
        <p className="text-sm text-muted mb-3">
          לפי הדרך שבה קנית לאחרונה, הסדר הזה מתאים יותר למסלול שלך בחנות:
        </p>
        <ol className="text-sm space-y-1 mb-4 list-decimal list-inside">
          {suggested.map(code => (
            <li key={code}>{labelMap[code]?.name ?? code}</li>
          ))}
        </ol>
        <div className="flex gap-2">
          {/* Primary action RIGHT in RTL (first in DOM = right with flex-row-reverse or dir=rtl) */}
          <button className="btn-primary flex-1" onClick={onAccept}>כן, עדכן</button>
          <button className="btn-ghost flex-1" onClick={onDecline}>לא עכשיו</button>
        </div>
      </div>
    </div>
  );
}
