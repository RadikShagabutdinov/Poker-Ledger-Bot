import type { Api, Bot, Context } from 'grammy';
import type { BotCommand, BotCommandScope, InlineKeyboardMarkup } from 'grammy/types';
import type { Logger } from 'pino';

import type { Language } from '@pokerledger/shared';

import type { ChatRow } from '../../db/schema';
import { translator } from '../../i18n';
import {
  ServiceError,
  createGame,
  findChatByTelegramId,
  listActiveGames,
  registerChat,
  userLanguage,
} from '../../services';
import { ANONYMOUS_ADMIN_ID, actorFrom, type BotDeps } from '../context';
import { escapeHtml } from '../html';
import { urlButton } from '../render/common';

const GROUP_COMMANDS = ['newgame', 'game', 'history', 'settings', 'help'] as const;
const PRIVATE_COMMANDS = ['start', 'help'] as const;

/** Command menus per scope and language; `/stats` stays hidden until V2. */
export async function setBotCommands(
  api: Pick<Api, 'setMyCommands'>,
  logger: Logger,
): Promise<void> {
  const menus: [BotCommandScope, readonly string[]][] = [
    [{ type: 'all_group_chats' }, GROUP_COMMANDS],
    [{ type: 'all_private_chats' }, PRIVATE_COMMANDS],
  ];
  for (const [scope, names] of menus) {
    for (const language of [undefined, 'ru', 'en'] as const) {
      const t = translator(language ?? 'en');
      const commands: BotCommand[] = names.map((command) => ({
        command,
        description: t(`commands.${command}`),
      }));
      try {
        await api.setMyCommands(commands, {
          scope,
          ...(language ? { language_code: language } : {}),
        });
      } catch (error) {
        logger.warn({ err: error, scope: scope.type, language }, 'setMyCommands failed');
      }
    }
  }
}

function keyboard(text: string, url: string): InlineKeyboardMarkup {
  return { inline_keyboard: [[urlButton(text, url)]] };
}

/** Bot commands in groups and private chats. */
export function registerCommandHandlers(bot: Bot, deps: BotDeps): void {
  const { services, links, logger } = deps;
  const group = bot.chatType(['group', 'supergroup']);
  const personal = bot.chatType('private');

  /** The chat of a group command, registered on the fly if the bot missed being added. */
  function chatOf(ctx: Context & { chat: { id: number; title?: string } }): ChatRow {
    const known = findChatByTelegramId(services, ctx.chat.id);
    if (known) {
      return known;
    }
    return registerChat(services, {
      tgChatId: ctx.chat.id,
      title: ctx.chat.title ?? '',
      botStatus: 'member',
      ...(ctx.from ? { addedBy: actorFrom(ctx.from) } : {}),
    }).chat;
  }

  async function replyCurrentGame(
    ctx: Context,
    chat: ChatRow,
    key: 'commands.currentGame' | 'commands.activeGameExists',
  ): Promise<void> {
    const t = translator(chat.language);
    const game = listActiveGames(services, chat.id)[0];
    if (!game) {
      await ctx.reply(t('commands.noActiveGame'), {
        reply_markup: keyboard(t('buttons.chatHome'), links.to('chat', chat.id)),
      });
      return;
    }
    await ctx.reply(t(key, { name: escapeHtml(game.name) }), {
      parse_mode: 'HTML',
      reply_markup: keyboard(t('buttons.open'), links.to('game', game.id)),
      ...(game.statusMessageId === null
        ? {}
        : {
            reply_parameters: {
              message_id: game.statusMessageId,
              allow_sending_without_reply: true,
            },
          }),
    });
  }

  group.command('newgame', async (ctx) => {
    const chat = chatOf(ctx);
    const t = translator(chat.language);
    if (ctx.from.id === ANONYMOUS_ADMIN_ID || ctx.message?.sender_chat) {
      await ctx.reply(t('commands.anonymous'));
      return;
    }
    const name = ctx.match.trim();
    try {
      const game = await createGame(services, actorFrom(ctx.from), chat.id, name ? { name } : {});
      // The status message goes out now rather than after the 2 s grouping.
      await deps.updater.flush(game.id);
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'ACTIVE_GAME_EXISTS') {
        await replyCurrentGame(ctx, chat, 'commands.activeGameExists');
      } else if (error instanceof ServiceError && error.code === 'NOT_CHAT_MEMBER') {
        await ctx.reply(t('commands.notMember'));
      } else {
        if (!(error instanceof ServiceError)) {
          logger.error({ err: error, chatId: chat.id }, '/newgame failed');
        }
        await ctx.reply(t('commands.error'));
      }
    }
  });

  group.command('game', async (ctx) => {
    await replyCurrentGame(ctx, chatOf(ctx), 'commands.currentGame');
  });

  group.command('history', async (ctx) => {
    const chat = chatOf(ctx);
    const t = translator(chat.language);
    await ctx.reply(t('commands.historyText'), {
      reply_markup: keyboard(t('buttons.history'), links.to('chat', chat.id)),
    });
  });

  group.command('settings', async (ctx) => {
    const chat = chatOf(ctx);
    const t = translator(chat.language);
    await ctx.reply(t('commands.settingsText'), {
      reply_markup: keyboard(t('buttons.settings'), links.to('settings', chat.id)),
    });
  });

  group.command('stats', async (ctx) => {
    await ctx.reply(translator(chatOf(ctx).language)('commands.stats'));
  });

  group.command('help', async (ctx) => {
    await ctx.reply(translator(chatOf(ctx).language)('commands.helpGroup'));
  });

  const languageOf = (ctx: Context): Language =>
    ctx.from ? userLanguage(services.db, actorFrom(ctx.from)) : 'ru';

  // Private chat: profile and chats in the Mini App, no games.
  personal.command('start', async (ctx) => {
    const t = translator(languageOf(ctx));
    const button = deps.miniAppUrl
      ? { text: t('buttons.app'), web_app: { url: deps.miniAppUrl } }
      : urlButton(t('buttons.app'), links.app);
    await ctx.reply(t('commands.welcomePrivate'), {
      reply_markup: { inline_keyboard: [[button]] },
    });
  });

  personal.command('help', async (ctx) => {
    await ctx.reply(translator(languageOf(ctx))('commands.helpPrivate'));
  });

  personal.command(['newgame', 'game', 'history', 'settings', 'stats'], async (ctx) => {
    await ctx.reply(translator(languageOf(ctx))('commands.groupOnly'));
  });
}
