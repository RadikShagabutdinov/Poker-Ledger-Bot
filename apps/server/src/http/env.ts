import type { Actor } from '../services';

/** Hono context variables: the authenticated Telegram user. */
export interface AppEnv {
  Variables: { actor: Actor };
}
