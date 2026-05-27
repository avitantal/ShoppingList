import { useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { DEPARTMENTS, type DepartmentCode, type DepartmentMeta } from '../lib/departments';
import { cn } from '../lib/utils';

interface Props {
  itemName: string;
  currentDepartment: DepartmentCode;
  onPick: (code: DepartmentCode) => void;
  onClose: () => void;
}

export function ChangeDepartmentSheet({ itemName, currentDepartment, onPick, onClose }: Props) {
  // Pressing Esc closes the sheet — same convention as LinkItemDialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const list: DepartmentMeta[] = DEPARTMENTS;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-surface border-t border-border rounded-t-2xl shadow-xl pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost w-8 h-8 p-0 shrink-0"
            aria-label="סגור"
          >
            <X size={18} />
          </button>
          <div className="min-w-0 text-end">
            <div className="text-xs text-muted">שנה מחלקה</div>
            <div className="text-sm font-medium truncate">{itemName}</div>
          </div>
        </div>
        <ul role="listbox" className="max-h-[60vh] overflow-y-auto py-1">
          {list.map((d) => {
            const selected = d.code === currentDepartment;
            return (
              <li key={d.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onPick(d.code)}
                  className={cn(
                    'w-full flex items-center gap-2 px-4 py-3 text-sm text-start hover:bg-muted/40',
                    selected && 'bg-muted/30',
                  )}
                >
                  <span className="flex-1 truncate">{d.name}</span>
                  {selected && <Check size={16} className="text-emerald-400" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
