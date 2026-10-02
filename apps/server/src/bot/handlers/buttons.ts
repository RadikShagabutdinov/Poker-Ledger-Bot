import type { Bot } from 'grammy';

import { formatNumber } from '@pokerledger/shared';

import { translator } from '../../i18n';
import { buySelf, undoLast, userLanguage } from '../../services';
import { parseGameCallback } from '../callbacks';
import { actorFrom, type BotDeps } from '../context';
import { notificationKey } from '../errors';

/**
 * Game message buttons: every press is answered with a notification
 * in the presser's language; at most one press per second.
 */
export function registerButtonHandlers(bot: Bot, deps: BotDeps): void {
  const { services, logger, rateLimiter } = deps;

  bot.on('callback_query:data', async (ctx) => {
    const actor = actorFrom(ctx.from);
    const language = userLanguage(services.db, actor);
    const t = translator(language);
    const answer = (text: string) => ctx.answerCallbackQuery({ text });

    const parsed = parseGameCallback(ctx.callbackQuery.data);
    if (!parsed) {
      await answer(t('notify.unknownButton'));
      return;
    }
    if (!rateLimiter.tryPress(actor.tgUserId)) {
      await answer(t('notify.tooOften'));
      return;
    }
    const { action, gameId } = parsed;
    try {
      switch (action) {
        case 'join': {
          const event = await buySelf(services, actor, gameId, { expect: 'buy_in' });
          await answer(t('notify.joined', { chips: formatNumber(event.chips, language) }));
          return;
        }
        case 'rebuy': {
          const event = await buySelf(services, actor, gameId, { expect: 'rebuy' });
          await answer(t('notify.rebought', { chips: formatNumber(event.chips, language) }));
          return;
        }
        case 'undo': {
          const event = await undoLast(services, actor, gameId, { mineOnly: true });
          await answer(
            t(`notify.undone_${event.type}`, { chips: formatNumber(event.chips, language) }),
          );
          return;
        }
      }
    } catch (error) {
      const key = notificationKey(error);
      if (key === undefined) {
        logger.error({ err: error, gameId, action }, 'button action failed');
      }
      await answer(t(key ?? 'notify.error'));
    }
  });
}
