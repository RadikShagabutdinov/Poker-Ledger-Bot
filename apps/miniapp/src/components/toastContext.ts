import { createContext, useContext } from 'react';

import { useErrorText } from '../i18n/hooks';

export type ToastKind = 'info' | 'error';

export const ToastContext = createContext<{
  show: (text: string, kind?: ToastKind) => void;
} | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  const errorText = useErrorText();
  if (!context) {
    throw new Error('useToast() outside of <ToastProvider>');
  }
  return {
    info: (text: string) => {
      context.show(text, 'info');
    },
    error: (error: unknown) => {
      context.show(errorText(error), 'error');
    },
    errorText: (text: string) => {
      context.show(text, 'error');
    },
  };
}
