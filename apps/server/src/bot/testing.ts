// Test helpers: a fake Telegram Bot API behind grammY's transformer, and update factories.
import { Api, Bot, type Transformer } from 'grammy';
import type { Chat, ChatMember, Update, User, UserFromGetMe } from 'grammy/types';
import { pino } from 'pino';

import type { Actor } from '../services';
import { createTestDeps, TG_CHAT_ID, type TestDeps } from '../services/testing';
import type { BotDeps } from './context';
import { installBotHandlers } from './index';
import { miniAppLinks } from './links';
import { PressRateLimiter } from './rateLimit';
import { BotMessageUpdater } from './updater';

export const BOT_INFO: UserFromGetMe = {
  id: 777,
  is_bot: true,
  first_name: 'Poker Ledger',
  username: 'poker_ledger_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
} as UserFromGetMe;

export const TEST_LINKS = miniAppLinks({
  botUsername: 'poker_ledger_bot',
  miniAppShortName: 'app',
});

export const silentLogger = pino({ level: 'silent' });

export interface ApiCall {
  readonly method: string;
  readonly payload: Record<string, unknown>;
}

interface Failure {
  readonly method: string;
  readonly errorCode: number;
  readonly description: string;
  remaining: number;
}

/** Records every Bot API call and answers like Telegram would. */
export class FakeTelegram {
  readonly calls: ApiCall[] = [];
  private readonly failures: Failure[] = [];
  private readonly members = new Map<string, ChatMember['status']>();
  private nextMessageId = 100;

  /** The next `times` calls of `method` fail with this error. */
  fail(method: string, errorCode: number, description: string, times = 1): void {
    this.failures.push({ method, errorCode, description, remaining: times });
  }

  setMember(chatId: number, userId: number, status: ChatMember['status']): void {
    this.members.set(`${String(chatId)}:${String(userId)}`, status);
  }

  callsOf(method: string): Record<string, unknown>[] {
    return this.calls.filter((c) => c.method === method).map((c) => c.payload);
  }

  clear(): void {
    this.calls.length = 0;
  }

  readonly transformer: Transformer = (_prev, method, payload) => {
    const body = payload as Record<string, unknown>;
    this.calls.push({ method, payload: body });
    const failure = this.failures.find((f) => f.method === method && f.remaining > 0);
    if (failure) {
      failure.remaining -= 1;
      return Promise.resolve({
        ok: false,
        error_code: failure.errorCode,
        description: failure.description,
      }) as never;
    }
    return Promise.resolve({
      ok: true,
      result: this.respond(method, body),
    }) as never;
  };

  private respond(method: string, payload: Record<string, unknown>): unknown {
    switch (method) {
      case 'sendMessage':
        return {
          message_id: this.nextMessageId++,
          date: 0,
          chat: { id: payload.chat_id, type: 'supergroup', title: 'Poker club' },
          text: payload.text,
        };
      case 'getChatMember': {
        const status =
          this.members.get(`${String(payload.chat_id)}:${String(payload.user_id)}`) ?? 'left';
        return {
          status,
          user: { id: payload.user_id, is_bot: false, first_name: 'User' },
          ...(status === 'restricted' ? { is_member: true } : {}),
        };
      }
      default:
        return true;
    }
  }
}

export function fakeApi(telegram: FakeTelegram): Api {
  const api = new Api('123:test');
  api.config.use(telegram.transformer);
  return api;
}

export interface TestBot {
  readonly bot: Bot;
  readonly telegram: FakeTelegram;
  readonly deps: TestDeps;
  readonly updater: BotMessageUpdater;
  readonly botDeps: BotDeps;
  /** Feeds one update through the handlers. */
  handle(update: Omit<Update, 'update_id'>): Promise<void>;
}

/**
 * A bot with handlers over in-memory services; the message updater is real and
 * talks to the fake API. Membership comes from `deps.setMembership`.
 */
export function createTestBot(options: { now?: () => number } = {}): TestBot {
  const telegram = new FakeTelegram();
  const base = createTestDeps();
  const now = options.now ?? base.now;
  const bot = new Bot('123:test', { botInfo: BOT_INFO });
  bot.api.config.use(telegram.transformer);
  const updater = new BotMessageUpdater({
    db: base.db,
    api: bot.api,
    links: TEST_LINKS,
    logger: silentLogger,
    now,
  });
  const scheduled = base.scheduled;
  const deps: TestDeps = {
    ...base,
    messageUpdater: {
      schedule: (gameId) => {
        scheduled.push(gameId);
        updater.schedule(gameId);
      },
    },
  };
  const botDeps: BotDeps = {
    services: deps,
    updater,
    links: TEST_LINKS,
    logger: silentLogger,
    rateLimiter: new PressRateLimiter(now),
    miniAppUrl: undefined,
  };
  installBotHandlers(bot, botDeps);
  let updateId = 1;
  return {
    bot,
    telegram,
    deps,
    updater,
    botDeps,
    handle: (update) => bot.handleUpdate({ update_id: updateId++, ...update }),
  };
}

export function tgUser(actor: Actor): User {
  return {
    id: actor.tgUserId,
    is_bot: false,
    first_name: actor.firstName,
    ...(actor.lastName ? { last_name: actor.lastName } : {}),
    ...(actor.languageCode ? { language_code: actor.languageCode } : {}),
  };
}

export const GROUP: Chat.SupergroupChat = {
  id: TG_CHAT_ID,
  type: 'supergroup',
  title: 'Poker club',
};

let messageId = 1;

/** A text message, e.g. a command, from `actor` in `chat`. */
export function textMessage(
  actor: Actor,
  text: string,
  chat: Chat = GROUP,
): Omit<Update, 'update_id'> {
  const command = /^\/\w+(@\w+)?/.exec(text)?.[0];
  return {
    message: {
      message_id: messageId++,
      date: 0,
      chat,
      from: tgUser(actor),
      text,
      ...(command
        ? { entities: [{ type: 'bot_command', offset: 0, length: command.length }] }
        : {}),
    },
  } as Omit<Update, 'update_id'>;
}

export function privateChat(actor: Actor): Chat.PrivateChat {
  return { id: actor.tgUserId, type: 'private', first_name: actor.firstName };
}

/** A press of an inline button with `data` under the message `messageId`. */
export function buttonPress(
  actor: Actor,
  data: string,
  chat: Chat = GROUP,
): Omit<Update, 'update_id'> {
  return {
    callback_query: {
      id: `cq-${String(messageId++)}`,
      from: tgUser(actor),
      chat_instance: 'ci',
      data,
      message: { message_id: 100, date: 0, chat, text: 'status' },
    },
  };
}

/** The bot's own membership in `chat` changed from `before` to `after`. */
export function botMembership(
  by: Actor,
  before: ChatMember['status'],
  after: ChatMember['status'],
  chat: Chat = GROUP,
): Omit<Update, 'update_id'> {
  const botUser = { id: BOT_INFO.id, is_bot: true, first_name: BOT_INFO.first_name };
  const member = (status: ChatMember['status']) =>
    status === 'administrator'
      ? { status, user: botUser, can_be_edited: false, can_pin_messages: true }
      : { status, user: botUser };
  return {
    my_chat_member: {
      chat,
      from: tgUser(by),
      date: 0,
      old_chat_member: member(before),
      new_chat_member: member(after),
    },
  } as Omit<Update, 'update_id'>;
}
