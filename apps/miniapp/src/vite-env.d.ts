/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL, e.g. `https://pokerledger.duckdns.org/api`; defaults to `/api`. */
  readonly VITE_API_URL?: string;
  /** Dev mock (SPEC §16.6): Telegram id of a member of the test group. */
  readonly VITE_DEV_USER_ID?: string;
  /** Dev mock: first name sent in initData; the server stores it as the user's name. */
  readonly VITE_DEV_FIRST_NAME?: string;
  /** Dev mock: `start_param`, e.g. `c_<chatId>` or `g_<gameId>`. */
  readonly VITE_DEV_START_PARAM?: string;
  /** Dev mock: Telegram `language_code`, `ru` by default. */
  readonly VITE_DEV_LANGUAGE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
