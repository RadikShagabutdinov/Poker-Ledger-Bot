import { and, eq, inArray } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { gameEvents, type GameEventRow } from '../schema';

/** All events of a game, including cancelled ones, in `id` order. */
export function listGameEvents(db: DbOrTx, gameId: string): GameEventRow[] {
  return db
    .select()
    .from(gameEvents)
    .where(eq(gameEvents.gameId, gameId))
    .orderBy(gameEvents.id)
    .all();
}

export function listEventsOfGames(db: DbOrTx, gameIds: readonly string[]): GameEventRow[] {
  if (gameIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(gameEvents)
    .where(inArray(gameEvents.gameId, [...gameIds]))
    .orderBy(gameEvents.id)
    .all();
}

export function insertGameEvent(
  db: DbOrTx,
  row: Omit<typeof gameEvents.$inferInsert, 'id'>,
): GameEventRow {
  return db.insert(gameEvents).values(row).returning().get();
}

export function markEventCancelled(
  db: DbOrTx,
  gameId: string,
  eventId: number,
  cancelledBy: number,
  cancelledAt: number,
): void {
  db.update(gameEvents)
    .set({ cancelledBy, cancelledAt })
    .where(and(eq(gameEvents.gameId, gameId), eq(gameEvents.id, eventId)))
    .run();
}
