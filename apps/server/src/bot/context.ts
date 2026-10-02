import type { User } from 'grammy/types';
import type { Logger } from 'pino';

import type { Actor, ServiceDeps } from '../services';
import type { MiniAppLinks } from './links';
import type { PressRateLimiter } from './rateLimit';

/** What the bot handlers need; all business logic goes through `services`. */
export interface BotDeps {
  readonly services: ServiceDeps;
  /** Sends the first status message right after `/newgame`. */
  readonly updater: { flush(gameId?: string): Promise<void> };
  readonly links: MiniAppLinks;
  readonly logger: Logger;
  readonly rateLimiter: PressRateLimiter;
  /** Mini App URL for `web_app` buttons in private chats. */
  readonly miniAppUrl: string | undefined;
}

export function actorFrom(user: User): Actor {
  return {
    tgUserId: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    username: user.username,
    languageCode: user.language_code,
  };
}

/** Telegram's stand-in sender for anonymous group admins. */
export const ANONYMOUS_ADMIN_ID = 1087968824;
