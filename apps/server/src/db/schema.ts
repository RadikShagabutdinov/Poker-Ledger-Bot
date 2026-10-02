// Drizzle schema. Times are UTC milliseconds, money and chips are integers.
// Fields for V2 and "later" features exist from V1.
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import type { Language } from '@pokerledger/shared';

export type BotStatus = 'member' | 'admin' | 'left';
export type GameType = 'cash' | 'tournament';
export type GameStatus = 'active' | 'finished' | 'deleted';
export type MismatchModeName = 'proportional' | 'single_player';
export type StoredEventType =
  | 'game_created'
  | 'player_added'
  | 'buy_in'
  | 'rebuy'
  | 'cash_out'
  | 'settings_changed'
  | 'game_finished'
  | 'game_reopened'
  | 'game_deleted'
  | 'settlement_edited'
  | 'reentry'
  | 'tournament_rebuy'
  | 'addon'
  | 'bust'
  | 'places_set';

/** JSON payload of an event: old/new values of service events, links between chip events. */
export interface EventPayload {
  /** `cash_out` written by finishing the game for a seated player. */
  source?: 'finish';
  /** The event this one replaces in a finished-game edit; it takes that event's place. */
  replaces?: number;
  [key: string]: unknown;
}

export const users = sqliteTable('users', {
  tgUserId: integer('tg_user_id').primaryKey(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  username: text('username'),
  language: text('language').$type<Language>(),
  payPhone: text('pay_phone'),
  payBank: text('pay_bank'),
  payNote: text('pay_note'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const chats = sqliteTable('chats', {
  id: text('id').primaryKey(),
  tgChatId: integer('tg_chat_id').notNull().unique(),
  title: text('title').notNull(),
  language: text('language').$type<Language>().notNull(),
  currency: text('currency').notNull(),
  stackChips: integer('stack_chips').notNull(),
  stackAmount: integer('stack_amount').notNull(),
  gameNameTemplate: text('game_name_template').notNull(),
  quickBuyins: text('quick_buyins', { mode: 'json' }).$type<number[]>().notNull(),
  prizeTemplate: text('prize_template', { mode: 'json' }).$type<unknown>(),
  gameCounter: integer('game_counter').notNull().default(0),
  botStatus: text('bot_status').$type<BotStatus>().notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const chatPlayers = sqliteTable(
  'chat_players',
  {
    id: text('id').primaryKey(),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id),
    tgUserId: integer('tg_user_id').references(() => users.tgUserId),
    displayName: text('display_name'),
    createdAt: integer('created_at').notNull(),
    mergedInto: text('merged_into'),
  },
  (t) => [
    uniqueIndex('chat_players_chat_user_uq')
      .on(t.chatId, t.tgUserId)
      .where(sql`${t.tgUserId} IS NOT NULL`),
    uniqueIndex('chat_players_chat_guest_name_uq')
      .on(t.chatId, sql`lower(${t.displayName})`)
      .where(sql`${t.tgUserId} IS NULL`),
  ],
);

export const games = sqliteTable(
  'games',
  {
    id: text('id').primaryKey(),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id),
    type: text('type').$type<GameType>().notNull(),
    name: text('name').notNull(),
    status: text('status').$type<GameStatus>().notNull(),
    currency: text('currency').notNull(),
    stackChips: integer('stack_chips').notNull(),
    stackAmount: integer('stack_amount').notNull(),
    tournamentConfig: text('tournament_config', { mode: 'json' }).$type<unknown>(),
    mismatchMode: text('mismatch_mode').$type<MismatchModeName>(),
    mismatchPlayerId: text('mismatch_player_id'),
    mismatchChips: integer('mismatch_chips'),
    settlementIsManual: integer('settlement_is_manual', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.tgUserId),
    statusMessageId: integer('status_message_id'),
    resultMessageId: integer('result_message_id'),
    version: integer('version').notNull().default(1),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('games_chat_status_idx').on(t.chatId, t.status),
    index('games_chat_finished_idx').on(t.chatId, t.finishedAt),
  ],
);

export const gamePlayers = sqliteTable(
  'game_players',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    playerId: text('player_id')
      .notNull()
      .references(() => chatPlayers.id),
    seatOrder: integer('seat_order').notNull(),
    addedBy: integer('added_by')
      .notNull()
      .references(() => users.tgUserId),
    addedAt: integer('added_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.playerId] })],
);

export const gameEvents = sqliteTable(
  'game_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    playerId: text('player_id').references(() => chatPlayers.id),
    type: text('type').$type<StoredEventType>().notNull(),
    chips: integer('chips'),
    amount: integer('amount'),
    payload: text('payload', { mode: 'json' }).$type<EventPayload>(),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.tgUserId),
    createdAt: integer('created_at').notNull(),
    cancelledBy: integer('cancelled_by'),
    cancelledAt: integer('cancelled_at'),
  },
  (t) => [index('game_events_game_idx').on(t.gameId, t.id)],
);

export const gameResults = sqliteTable(
  'game_results',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    playerId: text('player_id')
      .notNull()
      .references(() => chatPlayers.id),
    inChips: integer('in_chips').notNull(),
    outChips: integer('out_chips').notNull(),
    buyinCount: integer('buyin_count').notNull(),
    rebuyCount: integer('rebuy_count').notNull(),
    adjustmentChipsNum: integer('adjustment_chips_num').notNull(),
    adjustmentChipsDen: integer('adjustment_chips_den').notNull(),
    moneyResult: integer('money_result').notNull(),
    place: integer('place'),
    prize: integer('prize'),
    paidTotal: integer('paid_total'),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.playerId] })],
);

export const settlements = sqliteTable(
  'settlements',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    fromPlayerId: text('from_player_id')
      .notNull()
      .references(() => chatPlayers.id),
    toPlayerId: text('to_player_id')
      .notNull()
      .references(() => chatPlayers.id),
    amount: integer('amount').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [index('settlements_game_idx').on(t.gameId, t.position)],
);

/** Guest-to-Telegram linking (LATER-01). */
export const linkTokens = sqliteTable('link_tokens', {
  token: text('token').primaryKey(),
  playerId: text('player_id')
    .notNull()
    .references(() => chatPlayers.id),
  createdBy: integer('created_by').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
});

export type UserRow = typeof users.$inferSelect;
export type ChatRow = typeof chats.$inferSelect;
export type ChatPlayerRow = typeof chatPlayers.$inferSelect;
export type GameRow = typeof games.$inferSelect;
export type GamePlayerRow = typeof gamePlayers.$inferSelect;
export type GameEventRow = typeof gameEvents.$inferSelect;
export type GameResultRow = typeof gameResults.$inferSelect;
export type SettlementRow = typeof settlements.$inferSelect;
