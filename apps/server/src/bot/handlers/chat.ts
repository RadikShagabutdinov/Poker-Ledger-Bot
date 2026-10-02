import type { Bot } from 'grammy';
import type { ChatMember } from 'grammy/types';

import { translator } from '../../i18n';
import { migrateChat, registerChat, setBotStatus } from '../../services';
import { actorFrom, type BotDeps } from '../context';
import { urlButton } from '../render/common';

function isPresent(member: ChatMember): boolean {
  switch (member.status) {
    case 'creator':
    case 'administrator':
    case 'member':
      return true;
    case 'restricted':
      return member.is_member;
    case 'left':
    case 'kicked':
      return false;
  }
}

/** Bot added to or removed from a group, its rights changed, group migrated (SPEC §5.1). */
export function registerChatHandlers(bot: Bot, deps: BotDeps): void {
  const { services, links } = deps;

  bot.on('my_chat_member', async (ctx) => {
    const chat = ctx.chat;
    if (chat.type !== 'group' && chat.type !== 'supergroup') {
      return;
    }
    const { old_chat_member: before, new_chat_member: after } = ctx.myChatMember;
    if (!isPresent(after)) {
      // Data stays; adding the bot again restores everything (V1-CHAT-04).
      setBotStatus(services, chat.id, 'left');
      return;
    }
    const botStatus = after.status === 'administrator' ? 'admin' : 'member';
    if (isPresent(before)) {
      setBotStatus(services, chat.id, botStatus);
      return;
    }
    // Added (V1-CHAT-01/02): the chat language follows the user who added the bot.
    const { chat: row } = registerChat(services, {
      tgChatId: chat.id,
      title: chat.title,
      botStatus,
      addedBy: actorFrom(ctx.myChatMember.from),
    });
    const t = translator(row.language);
    await ctx.reply(t('chat.welcome'), {
      reply_markup: {
        inline_keyboard: [[urlButton(t('buttons.settings'), links.to('settings', row.id))]],
      },
    });
  });

  // Group → supergroup (V1-CHAT-03). Both service messages arrive; the first one wins.
  bot.on('message:migrate_to_chat_id', (ctx) => {
    migrateChat(services, ctx.chat.id, ctx.message.migrate_to_chat_id);
  });
  bot.on('message:migrate_from_chat_id', (ctx) => {
    migrateChat(services, ctx.message.migrate_from_chat_id, ctx.chat.id);
  });
}
