import { and, desc, eq, gte, inArray, lt, ne, or, sql, type SQL } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { games, type GameRow, type GameStatus } from '../schema';

export function findGame(db: DbOrTx, id: string): GameRow | undefined {
  return db.select().from(games).where(eq(games.id, id)).get();
}

export function listGamesByStatus(db: DbOrTx, chatId: string, status: GameStatus): GameRow[] {
  return db
    .select()
    .from(games)
    .where(and(eq(games.chatId, chatId), eq(games.status, status)))
    .orderBy(games.startedAt)
    .all();
}

export function listActiveGamesOfChats(db: DbOrTx, chatIds: readonly string[]): GameRow[] {
  if (chatIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(games)
    .where(and(inArray(games.chatId, [...chatIds]), eq(games.status, 'active')))
    .all();
}

export interface GamePageQuery {
  readonly chatId: string;
  readonly from?: number | undefined;
  readonly to?: number | undefined;
  /** Continue after this `(startedAt, id)` position. */
  readonly after?: { readonly startedAt: number; readonly id: string } | undefined;
  readonly limit: number;
}

/** Not deleted games of a chat, newest first by `started_at`, then `id`. */
export function listGamesPage(db: DbOrTx, q: GamePageQuery): GameRow[] {
  const conditions: SQL[] = [eq(games.chatId, q.chatId), ne(games.status, 'deleted')];
  if (q.from !== undefined) {
    conditions.push(gte(games.startedAt, q.from));
  }
  if (q.to !== undefined) {
    conditions.push(lt(games.startedAt, q.to));
  }
  if (q.after) {
    conditions.push(
      or(
        lt(games.startedAt, q.after.startedAt),
        and(eq(games.startedAt, q.after.startedAt), lt(games.id, q.after.id)),
      ) as SQL,
    );
  }
  return db
    .select()
    .from(games)
    .where(and(...conditions))
    .orderBy(desc(games.startedAt), desc(games.id))
    .limit(q.limit)
    .all();
}

export function insertGame(db: DbOrTx, row: typeof games.$inferInsert): GameRow {
  return db.insert(games).values(row).returning().get();
}

export function updateGame(
  db: DbOrTx,
  id: string,
  patch: Partial<Omit<GameRow, 'id' | 'chatId' | 'version'>>,
): GameRow {
  return db.update(games).set(patch).where(eq(games.id, id)).returning().get();
}

/** `version++`; every game mutation calls it (SPEC §9.4). */
export function bumpGameVersion(db: DbOrTx, id: string): number {
  const row = db
    .update(games)
    .set({ version: sql`${games.version} + 1` })
    .where(eq(games.id, id))
    .returning({ version: games.version })
    .get();
  return row.version;
}
