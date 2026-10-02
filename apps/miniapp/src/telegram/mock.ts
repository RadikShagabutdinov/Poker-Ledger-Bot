// Dev only (SPEC §16.6): a fake Telegram environment for the browser. The server must run with
// `DEV_SKIP_INIT_DATA_CHECK=true`; it still checks chat membership with the real Bot API, so
// `VITE_DEV_USER_ID` has to be a member of the test group. The server also stores the name
// it receives, hence `VITE_DEV_FIRST_NAME`.
import { isTMA, mockTelegramEnv } from '@tma.js/sdk-react';

const LIGHT = {
  bg_color: '#ffffff',
  secondary_bg_color: '#efeff4',
  section_bg_color: '#ffffff',
  text_color: '#000000',
  hint_color: '#8e8e93',
  subtitle_text_color: '#8e8e93',
  link_color: '#007aff',
  accent_text_color: '#007aff',
  button_color: '#007aff',
  button_text_color: '#ffffff',
  destructive_text_color: '#ff3b30',
  section_separator_color: '#c8c7cc',
  header_bg_color: '#f8f8f8',
  bottom_bar_bg_color: '#f8f8f8',
  section_header_text_color: '#6d6d72',
} as const;

const DARK = {
  bg_color: '#000000',
  secondary_bg_color: '#1c1c1d',
  section_bg_color: '#2c2c2e',
  text_color: '#ffffff',
  hint_color: '#98989e',
  subtitle_text_color: '#98989e',
  link_color: '#3e88f7',
  accent_text_color: '#3e88f7',
  button_color: '#3e88f7',
  button_text_color: '#ffffff',
  destructive_text_color: '#eb5545',
  section_separator_color: '#3d3d40',
  header_bg_color: '#1a1a1a',
  bottom_bar_bg_color: '#1d1d1d',
  section_header_text_color: '#8d8e93',
} as const;

/** Mocks the environment unless the page really runs inside Telegram; returns true if mocked. */
export function mockTelegramIfNeeded(): boolean {
  if (isTMA()) {
    return false;
  }
  const env = import.meta.env;
  const startParam = env.VITE_DEV_START_PARAM || undefined;
  const user = {
    id: Number(env.VITE_DEV_USER_ID || '1'),
    first_name: env.VITE_DEV_FIRST_NAME || 'Dev',
    language_code: env.VITE_DEV_LANGUAGE || 'ru',
  };
  const initData = new URLSearchParams({
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
    hash: 'dev',
    signature: 'dev',
    ...(startParam ? { start_param: startParam } : {}),
  });
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  mockTelegramEnv({
    launchParams: {
      tgWebAppThemeParams: dark ? DARK : LIGHT,
      tgWebAppData: initData,
      tgWebAppVersion: '8.0',
      tgWebAppPlatform: 'tdesktop',
      ...(startParam ? { tgWebAppStartParam: startParam } : {}),
    },
  });
  return true;
}
