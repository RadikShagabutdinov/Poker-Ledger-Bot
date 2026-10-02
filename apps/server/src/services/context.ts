import { upsertUserName } from '../db/repositories/users';
import type { DbOrTx } from '../db/client';

/** The Telegram user performing an action, as the bot or initData describes them. */
export interface Actor {
  readonly tgUserId: number;
  readonly firstName: string;
  readonly lastName?: string | undefined;
  readonly username?: string | undefined;
  /** Telegram `language_code`. */
  readonly languageCode?: string | undefined;
}

/** Creates the user or refreshes their name on every interaction (V1-PROF-04). */
export function touchUser(db: DbOrTx, actor: Actor, now: number): void {
  upsertUserName(
    db,
    {
      tgUserId: actor.tgUserId,
      firstName: actor.firstName,
      lastName: actor.lastName ?? null,
      username: actor.username ?? null,
    },
    now,
  );
}

/** `touchUser` in its own statement, for transports (V1-PROF-04 on every API request). */
export function touchActor(
  deps: { readonly db: DbOrTx; readonly now: () => number },
  actor: Actor,
): void {
  touchUser(deps.db, actor, deps.now());
}

/** `ru*` → `ru`, any other code → `en`, unknown → `fallback`. */
export function languageFromCode(code: string | undefined, fallback: 'ru' | 'en'): 'ru' | 'en' {
  if (!code) {
    return fallback;
  }
  return code.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}
