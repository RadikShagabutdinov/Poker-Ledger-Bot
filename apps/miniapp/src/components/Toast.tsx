import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { ToastContext, type ToastKind } from './toastContext';

const TOAST_MS = 3_500;

/** Short messages at the bottom of the screen: confirmations and API errors. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; text: string; kind: ToastKind } | null>(null);

  const show = useCallback((text: string, kind: ToastKind = 'info') => {
    setToast({ id: Date.now(), text, kind });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, TOAST_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext value={value}>
      {children}
      {toast
        ? createPortal(
            <div
              key={toast.id}
              className={`toast toast-${toast.kind}`}
              role={toast.kind === 'error' ? 'alert' : 'status'}
            >
              {toast.text}
            </div>,
            document.body,
          )
        : null}
    </ToastContext>
  );
}
