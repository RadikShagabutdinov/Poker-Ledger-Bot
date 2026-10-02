import {
  chatSettingsPatchSchema,
  type ChatSettingsPatch,
  type Language,
} from '@pokerledger/shared';

import {
  chatHasData,
  deleteChat,
  findChat,
  findChatByTgId,
  insertChat,
  updateChat,
} from '../db/repositories/chats';
import { newId } from '../db/ids';
import type { BotStatus, ChatRow } from '../db/schema';
import { languageFromCode, touchUser, type Actor } from './context';
import type { ServiceDeps } from './deps';
import { ServiceError, parseInput } from './errors';
import { renderGameName } from './games';
import { assertChatMember, resolveChatAccess } from './permissions';
import { ensureChatPlayer } from './players';

/** Chat defaults (V1-SET-01..05). */
export const CHAT_DEFAULTS = {
  currency: 'RUB',
  stackChips: 30_000,
  stackAmount: 1_000,
  quickBuyins: [1, 0.5],
  gameNameTemplate: { ru: 'Покер {date}', en: 'Poker {date}' },
} as const;

export interface ChatView {
  readonly id: string;
  readonly title: string;
  readonly language: Language;
  readonly currency: string;
  readonly stack: { readonly chips: number; readonly amount: number };
  readonly gameNameTemplate: string;
  readonly quickBuyins: readonly number[];
  readonly botStatus: BotStatus;
  /** The current user is a chat admin. */
  readonly isAdmin: boolean;
  /** The name the next game gets from the template; prefills the create form (V1-GAME-02). */
  readonly nextGameName: string;
}

export function toChatView(
  deps: Pick<ServiceDeps, 'now' | 'timeZone'>,
  chat: ChatRow,
  isAdmin: boolean,
): ChatView {
  return {
    id: chat.id,
    title: chat.title,
    language: chat.language,
    currency: chat.currency,
    stack: { chips: chat.stackChips, amount: chat.stackAmount },
    gameNameTemplate: chat.gameNameTemplate,
    quickBuyins: chat.quickBuyins,
    botStatus: chat.botStatus,
    isAdmin,
    nextGameName: renderGameName(chat.gameNameTemplate, {
      language: chat.language,
      timeZone: deps.timeZone,
      now: deps.now(),
      n: chat.gameCounter + 1,
    }),
  };
}

export interface RegisterChatInput {
  readonly tgChatId: number;
  readonly title: string;
  readonly botStatus: BotStatus;
  /** The user who added the bot; their language becomes the chat language (V1-SET-04). */
  readonly addedBy?: Actor | undefined;
}

/**
 * Bot added to a group (V1-CHAT-01): creates the chat with defaults, or restores an
 * existing one after the bot was removed and added again (V1-CHAT-04).
 */
export function registerChat(
  deps: ServiceDeps,
  input: RegisterChatInput,
): { chat: ChatRow; created: boolean } {
  const now = deps.now();
  return deps.db.transaction((tx) => {
    if (input.addedBy) {
      touchUser(tx, input.addedBy, now);
    }
    const existing = findChatByTgId(tx, input.tgChatId);
    if (existing) {
      const chat = updateChat(tx, existing.id, {
        title: input.title,
        botStatus: input.botStatus,
        updatedAt: now,
      });
      return { chat, created: false };
    }
    const language = languageFromCode(input.addedBy?.languageCode, 'ru');
    const chat = insertChat(tx, {
      id: newId(),
      tgChatId: input.tgChatId,
      title: input.title,
      language,
      currency: CHAT_DEFAULTS.currency,
      stackChips: CHAT_DEFAULTS.stackChips,
      stackAmount: CHAT_DEFAULTS.stackAmount,
      gameNameTemplate: CHAT_DEFAULTS.gameNameTemplate[language],
      quickBuyins: [...CHAT_DEFAULTS.quickBuyins],
      prizeTemplate: null,
      gameCounter: 0,
      botStatus: input.botStatus,
      createdAt: now,
      updatedAt: now,
    });
    return { chat, created: true };
  });
}

/** Bot status changes; `left` keeps all data (V1-CHAT-04). */
export function setBotStatus(
  deps: Pick<ServiceDeps, 'db' | 'now'>,
  tgChatId: number,
  botStatus: BotStatus,
): void {
  const chat = findChatByTgId(deps.db, tgChatId);
  if (chat) {
    updateChat(deps.db, chat.id, { botStatus, updatedAt: deps.now() });
  }
}

/**
 * Group migrated to a supergroup: keep the data under the new id (V1-CHAT-03).
 * Idempotent. An empty chat already registered under the new id (an update about
 * the supergroup came before the migration message) is replaced by the old one.
 */
export function migrateChat(deps: ServiceDeps, fromTgChatId: number, toTgChatId: number): void {
  deps.db.transaction((tx) => {
    const chat = findChatByTgId(tx, fromTgChatId);
    if (!chat) {
      return;
    }
    const target = findChatByTgId(tx, toTgChatId);
    if (target) {
      if (chatHasData(tx, target.id)) {
        return;
      }
      deleteChat(tx, target.id);
    }
    updateChat(tx, chat.id, {
      tgChatId: toTgChatId,
      ...(target ? { botStatus: target.botStatus } : {}),
      updatedAt: deps.now(),
    });
  });
}

export function findChatByTelegramId(deps: ServiceDeps, tgChatId: number): ChatRow | undefined {
  return findChatByTgId(deps.db, tgChatId);
}

/**
 * Loads a chat and checks that the actor is its member. A member opening the chat in
 * the Mini App becomes a player of the chat (V1-PL-01).
 */
export async function loadChatForMember(
  deps: ServiceDeps,
  actor: Actor,
  chatId: string,
): Promise<{ chat: ChatRow; isAdmin: boolean }> {
  const chat = findChat(deps.db, chatId);
  if (!chat) {
    throw new ServiceError('NOT_FOUND');
  }
  const access = await resolveChatAccess(deps, chat, actor);
  assertChatMember(access);
  const now = deps.now();
  deps.db.transaction((tx) => {
    touchUser(tx, actor, now);
    ensureChatPlayer(tx, chat.id, actor.tgUserId, now);
  });
  return { chat, isAdmin: access.isAdmin };
}

/** `GET /chats/:chatId`. */
export async function getChat(deps: ServiceDeps, actor: Actor, chatId: string): Promise<ChatView> {
  const { chat, isAdmin } = await loadChatForMember(deps, actor, chatId);
  return toChatView(deps, chat, isAdmin);
}

/**
 * `PATCH /chats/:chatId/settings`, any chat member (SPEC §19.1). Existing games
 * keep their snapshot (V1-SET-07).
 */
export async function updateChatSettings(
  deps: ServiceDeps,
  actor: Actor,
  chatId: string,
  patch: ChatSettingsPatch,
): Promise<ChatView> {
  const input = parseInput(chatSettingsPatchSchema, patch);
  const { chat, isAdmin } = await loadChatForMember(deps, actor, chatId);
  const updated = updateChat(deps.db, chat.id, {
    ...(input.language !== undefined ? { language: input.language } : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
    ...(input.stack !== undefined
      ? { stackChips: input.stack.chips, stackAmount: input.stack.amount }
      : {}),
    ...(input.gameNameTemplate !== undefined ? { gameNameTemplate: input.gameNameTemplate } : {}),
    ...(input.quickBuyins !== undefined ? { quickBuyins: input.quickBuyins } : {}),
    updatedAt: deps.now(),
  });
  return toChatView(deps, updated, isAdmin);
}
