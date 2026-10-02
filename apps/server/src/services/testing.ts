// Test helpers: in-memory database with migrations and fake external dependencies.
import { openDatabase, runMigrations } from '../db/client';
import { MIGRATIONS_FOLDER } from '../main';
import type { Actor } from './context';
import { registerChat } from './chats';
import type { Membership, ServiceDeps } from './deps';
import { addPlayerToGame, createGame } from './games';
import { recordBuy, recordCashOut } from './events';
import { findGame } from '../db/repositories/games';
import type { ChatRow, GameRow } from '../db/schema';

export interface TestDeps extends ServiceDeps {
  /** Game ids passed to `messageUpdater.schedule`, in call order. */
  readonly scheduled: string[];
  /** Sets the membership of a user in a Telegram chat (default `none`). */
  setMembership(tgChatId: number, tgUserId: number, membership: Membership): void;
  /** Moves the fake clock forward. */
  advance(ms: number): void;
}

export const START_TIME = Date.UTC(2026, 8, 15, 18, 0, 0);

export function createTestDeps(): TestDeps {
  const database = openDatabase(':memory:');
  runMigrations(database.db, MIGRATIONS_FOLDER);
  const memberships = new Map<string, Membership>();
  const scheduled: string[] = [];
  let time = START_TIME;
  return {
    db: database.db,
    membership: {
      getMembership: (tgChatId, tgUserId) =>
        Promise.resolve(memberships.get(`${String(tgChatId)}:${String(tgUserId)}`) ?? 'none'),
    },
    messageUpdater: { schedule: (gameId) => scheduled.push(gameId) },
    now: () => time,
    timeZone: 'Europe/Moscow',
    scheduled,
    setMembership: (tgChatId, tgUserId, membership) =>
      memberships.set(`${String(tgChatId)}:${String(tgUserId)}`, membership),
    advance: (ms) => {
      time += ms;
    },
  };
}

export function actor(tgUserId: number, firstName: string, extra: Partial<Actor> = {}): Actor {
  return { tgUserId, firstName, ...extra };
}

export const ALICE = actor(1, 'Alice', { languageCode: 'ru' });
export const BOB = actor(2, 'Bob');
export const CAROL = actor(3, 'Carol');
export const DAVE = actor(4, 'Dave');
/** Not a member of the test chat. */
export const MALLORY = actor(99, 'Mallory');

export const TG_CHAT_ID = -100123;

/**
 * A chat where Alice is an admin and Bob, Carol, Dave are members; Alice added the bot.
 */
export function setupChat(deps: TestDeps, tgChatId = TG_CHAT_ID): ChatRow {
  const { chat } = registerChat(deps, {
    tgChatId,
    title: 'Poker club',
    botStatus: 'admin',
    addedBy: ALICE,
  });
  deps.setMembership(tgChatId, ALICE.tgUserId, 'admin');
  for (const a of [BOB, CAROL, DAVE]) {
    deps.setMembership(tgChatId, a.tgUserId, 'member');
  }
  return chat;
}

/** A chat and an active game created by Bob. */
export async function setupGame(deps: TestDeps): Promise<{ chat: ChatRow; game: GameRow }> {
  const chat = setupChat(deps);
  const game = await createGame(deps, BOB, chat.id);
  deps.scheduled.length = 0;
  return { chat, game };
}

/** Adds guests to a game (as Bob) and returns their player ids in order. */
export async function addGuests(
  deps: TestDeps,
  gameId: string,
  names: readonly string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const guestName of names) {
    ids.push((await addPlayerToGame(deps, BOB, gameId, { guestName })).playerId);
  }
  return ids;
}

/**
 * The sample game up to the finish: Вася left with 12 000; Петя, Коля, Дима are seated.
 */
export async function playSampleGame(
  deps: TestDeps,
  gameId: string,
): Promise<{ vasya: string; petya: string; kolya: string; dima: string }> {
  const [vasya, petya, kolya, dima] = (await addGuests(deps, gameId, [
    'Вася',
    'Петя',
    'Коля',
    'Дима',
  ])) as [string, string, string, string];
  for (const playerId of [vasya, petya, kolya, dima]) {
    await recordBuy(deps, BOB, gameId, { playerId, chips: 30_000 });
  }
  await recordBuy(deps, BOB, gameId, { playerId: vasya, chips: 30_000 });
  await recordBuy(deps, BOB, gameId, { playerId: kolya, chips: 15_000 });
  await recordCashOut(deps, BOB, gameId, { playerId: vasya, chips: 12_000 });
  return { vasya, petya, kolya, dima };
}

export function currentVersion(deps: TestDeps, gameId: string): number {
  return (findGame(deps.db, gameId) as GameRow).version;
}
