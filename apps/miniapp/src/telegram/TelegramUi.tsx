// Native Telegram controls: `MainButton`, `BackButton` and confirmation popups.
// In the browser mock and in tests Telegram draws nothing, so DOM stand-ins are rendered.
import { backButton, mainButton } from '@tma.js/sdk-react';
import { useContext, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';

import { NativeUiContext } from './nativeUi';

export function TelegramUiProvider({ native, children }: { native: boolean; children: ReactNode }) {
  return <NativeUiContext value={native}>{children}</NativeUiContext>;
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export interface MainButtonProps {
  readonly text: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly loading?: boolean;
}

/** The main action of a screen: Telegram's `MainButton` while mounted. */
export function MainButton({ text, onClick, disabled = false, loading = false }: MainButtonProps) {
  const native = useContext(NativeUiContext);
  const handler = useLatest(onClick);

  useEffect(() => {
    if (!native) return;
    mainButton.setParams.ifAvailable({
      text,
      isVisible: true,
      isEnabled: !disabled && !loading,
      isLoaderVisible: loading,
    });
  }, [native, text, disabled, loading]);

  useEffect(() => {
    if (!native) return;
    const off = mainButton.onClick.ifAvailable(() => {
      handler.current();
    });
    return () => {
      if (off.ok) off.data();
      mainButton.setParams.ifAvailable({ isVisible: false, isLoaderVisible: false });
    };
  }, [native, handler]);

  if (native) return null;
  return createPortal(
    <div className="main-button-bar">
      <button
        type="button"
        className="button button-primary button-wide"
        disabled={disabled || loading}
        onClick={onClick}
      >
        {loading ? '…' : text}
      </button>
    </div>,
    document.body,
  );
}

/** Telegram's `BackButton`, shown when there is a screen to go back to. */
export function BackButton() {
  const native = useContext(NativeUiContext);
  const navigate = useNavigate();
  const canGoBack = useLocation().key !== 'default';

  useEffect(() => {
    if (!native || !canGoBack) return;
    backButton.show.ifAvailable();
    const off = backButton.onClick.ifAvailable(() => {
      void navigate(-1);
    });
    return () => {
      if (off.ok) off.data();
      backButton.hide.ifAvailable();
    };
  }, [native, canGoBack, navigate]);

  if (native || !canGoBack) return null;
  return (
    <button type="button" className="back-link" onClick={() => void navigate(-1)}>
      ←
    </button>
  );
}
