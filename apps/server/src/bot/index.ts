import type { Bot } from 'grammy';

import type { BotDeps } from './context';
import { registerButtonHandlers } from './handlers/buttons';
import { registerChatHandlers } from './handlers/chat';
import { registerCommandHandlers } from './handlers/commands';

export { TelegramMembershipChecker } from './membership';
export { BotMessageUpdater } from './updater';
export { miniAppLinks } from './links';
export { PressRateLimiter } from './rateLimit';
export { setBotCommands } from './handlers/commands';
export type { BotDeps } from './context';

/** Updates the bot subscribes to (long polling). */
export const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member'] as const;

/** Bot transport over the services (SPEC §9.4): handlers hold no business logic. */
export function installBotHandlers(bot: Bot, deps: BotDeps): void {
  registerChatHandlers(bot, deps);
  registerCommandHandlers(bot, deps);
  registerButtonHandlers(bot, deps);
  bot.catch((error) => {
    deps.logger.error(
      { err: error.error, updateId: error.ctx.update.update_id },
      'bot update failed',
    );
  });
}
