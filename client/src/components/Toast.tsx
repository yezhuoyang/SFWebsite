/**
 * Lightweight toast notification system.
 *
 * Provides a `useNotify()` hook that any component can call to show
 * a transient banner at top-center. Toasts auto-dismiss after a
 * timeout (default 6 s) or when the user clicks ×.
 *
 * Used by the Submit / Grade buttons to surface every grade outcome
 * (success, compile error, Admitted-detected, network failure) — the
 * subtle button-color change wasn't enough.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ToastKind = 'success' | 'warning' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  /** ms until auto-dismiss; 0 = sticky. */
  duration?: number;
}

interface NotifyAPI {
  notify: (t: Omit<Toast, 'id'>) => void;
}

const Ctx = createContext<NotifyAPI | null>(null);

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { ...t, id }]);
  }, []);
  const dismiss = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  return (
    <Ctx.Provider value={{ notify }}>
      {children}
      {createPortal(
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] flex flex-col gap-2 pointer-events-none">
          {toasts.map(t => (
            <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>,
        document.body
      )}
    </Ctx.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const dur = toast.duration ?? 6000;
    if (dur <= 0) return;
    const t = setTimeout(onDismiss, dur);
    return () => clearTimeout(t);
  }, [toast.duration, onDismiss]);

  const styles: Record<ToastKind, string> = {
    success: 'bg-emerald-600 text-white border-emerald-700',
    warning: 'bg-amber-500 text-white border-amber-600',
    error: 'bg-red-600 text-white border-red-700',
    info: 'bg-indigo-600 text-white border-indigo-700',
  };
  const icon: Record<ToastKind, string> = {
    success: '✓',
    warning: '⚠',
    error: '✗',
    info: 'ℹ',
  };
  return (
    <div
      className={`pointer-events-auto min-w-[320px] max-w-[480px] rounded-lg shadow-lg border px-4 py-3 ${styles[toast.kind]}`}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none mt-0.5 font-bold">{icon[toast.kind]}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{toast.title}</div>
          {toast.message && (
            <div className="text-[12px] mt-1 opacity-95 break-words font-mono whitespace-pre-wrap leading-snug">
              {toast.message}
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-white/70 hover:text-white text-lg leading-none px-1"
          aria-label="Dismiss"
        >×</button>
      </div>
    </div>
  );
}

export function useNotify(): NotifyAPI['notify'] {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Allow components to be used without provider — fall back to console.
    return (t) => {
      // eslint-disable-next-line no-console
      console.warn('[notify] no NotifyProvider — toast not shown:', t);
    };
  }
  return ctx.notify;
}
