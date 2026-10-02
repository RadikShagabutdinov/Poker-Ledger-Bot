import { popup } from '@tma.js/sdk-react';
import { createContext, useContext } from 'react';

/** True inside real Telegram; false in the browser mock and tests (DOM stand-ins). */
export const NativeUiContext = createContext(false);

export interface ConfirmOptions {
  readonly message: string;
  readonly title?: string;
  /** Text of the confirming button. */
  readonly ok: string;
  readonly destructive?: boolean;
}

/** Asks for confirmation with the native `popup` (SPEC §12.7), `window.confirm` otherwise. */
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const native = useContext(NativeUiContext);
  return async ({ message, title, ok, destructive = false }) => {
    if (native && popup.show.isAvailable()) {
      const id = await popup.show({
        message,
        ...(title !== undefined ? { title } : {}),
        buttons: [
          { id: 'ok', type: destructive ? 'destructive' : 'default', text: ok },
          { type: 'cancel' },
        ],
      });
      return id === 'ok';
    }
    return window.confirm(title !== undefined ? `${title}\n\n${message}` : message);
  };
}
