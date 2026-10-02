// Telegram environment: SDK init, theme, viewport and native buttons. Only `@tma.js`
// is used; the official `telegram-web-app.js` script must not be loaded next to it.
import {
  backButton,
  init,
  mainButton,
  miniApp,
  retrieveLaunchParams,
  retrieveRawInitData,
  themeParams,
  viewport,
} from '@tma.js/sdk-react';
import { focusManager } from '@tanstack/react-query';

export interface LaunchContext {
  readonly initDataRaw: string;
  readonly startParam: string | undefined;
  /** Telegram `language_code` of the user. */
  readonly languageCode: string | undefined;
}

/** Reads the launch parameters; `null` outside Telegram. */
export function readLaunchContext(): LaunchContext | null {
  try {
    const params = retrieveLaunchParams();
    const initDataRaw = retrieveRawInitData();
    if (initDataRaw === undefined) {
      return null;
    }
    return {
      initDataRaw,
      startParam: params.tgWebAppStartParam,
      languageCode: params.tgWebAppData?.user?.language_code,
    };
  } catch {
    return null;
  }
}

/** Mounts the SDK features the app uses and binds the theme to CSS variables. */
export function bootstrapTelegram(): void {
  init();
  if (miniApp.mount.isAvailable()) {
    miniApp.mount();
    miniApp.bindCssVars.ifAvailable();
  }
  if (themeParams.mount.isAvailable()) {
    themeParams.mount();
    themeParams.bindCssVars.ifAvailable();
  }
  if (viewport.mount.isAvailable()) {
    void viewport
      .mount()
      .then(() => {
        viewport.bindCssVars.ifAvailable();
        viewport.expand.ifAvailable();
      })
      .catch(() => undefined);
  }
  backButton.mount.ifAvailable();
  mainButton.mount.ifAvailable();
  syncFocusWithMiniApp();
  miniApp.ready.ifAvailable();
}

/**
 * Polling pauses while the Mini App is hidden: TanStack Query treats a minimized
 * Mini App like a hidden tab and refetches when it comes back.
 */
function syncFocusWithMiniApp(): void {
  focusManager.setEventListener((setFocused) => {
    const onVisibility = () => {
      setFocused(document.visibilityState !== 'hidden' && miniApp.isActive());
    };
    window.addEventListener('visibilitychange', onVisibility, false);
    const off = miniApp.isActive.sub(onVisibility);
    return () => {
      window.removeEventListener('visibilitychange', onVisibility);
      off();
    };
  });
}
