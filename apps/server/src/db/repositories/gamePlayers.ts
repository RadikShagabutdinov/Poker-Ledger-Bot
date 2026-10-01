import { and, eq, inArray, max } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { gamePlayers, type GamePlayerRow } from '../schema';

/** Players of a game in seat order. */
export function listGamePlayers(db: DbOrTx, gameId: string): GamePlayerRow[] {
  return db
    .select()
    .from(gamePlayers)
    .where(eq(gamePlayers.gameId, gameId))
    .orderBy(gamePlayers.seatOrder)
    .all();
}

export function listGamePlayersOfGames(db: DbOrTx, gameIds: readonly string[]): GamePlayerRow[] {
  if (gameIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(gamePlayers)
    .where(inArray(gamePlayers.gameId, [...gameIds]))
    .orderBy(gamePlayers.seatOrder)
    .all();
}

export function findGamePlayer(
  db: DbOrTx,
  gameId: string,
  playerId: string,
): GamePlayerRow | undefined {
  return db
    .select()
    .from(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, playerId)))
    .get();
}

export function nextSeatOrder(db: DbOrTx, gameId: string): number {
  const row = db
    .select({ max: max(gamePlayers.seatOrder) })
    .from(gamePlayers)
    .where(eq(gamePlayers.gameId, gameId))
    .get();
  return (row?.max ?? 0) + 1;
}

export function insertGamePlayer(db: DbOrTx, row: GamePlayerRow): void {
  db.insert(gamePlayers).values(row).run();
}
