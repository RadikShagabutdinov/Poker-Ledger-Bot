import { and, eq, inArray } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { gamePlayers, gameResults, type GameResultRow } from '../schema';

/** Results of a game in seat order. */
export function listGameResults(db: DbOrTx, gameId: string): GameResultRow[] {
  return db
    .select({ result: gameResults })
    .from(gameResults)
    .innerJoin(
      gamePlayers,
      and(
        eq(gamePlayers.gameId, gameResults.gameId),
        eq(gamePlayers.playerId, gameResults.playerId),
      ),
    )
    .where(eq(gameResults.gameId, gameId))
    .orderBy(gamePlayers.seatOrder)
    .all()
    .map((row) => row.result);
}

export function listResultsOfGames(db: DbOrTx, gameIds: readonly string[]): GameResultRow[] {
  if (gameIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(gameResults)
    .where(inArray(gameResults.gameId, [...gameIds]))
    .all();
}

export function replaceGameResults(
  db: DbOrTx,
  gameId: string,
  rows: readonly GameResultRow[],
): void {
  deleteGameResults(db, gameId);
  if (rows.length > 0) {
    db.insert(gameResults)
      .values([...rows])
      .run();
  }
}

export function deleteGameResults(db: DbOrTx, gameId: string): void {
  db.delete(gameResults).where(eq(gameResults.gameId, gameId)).run();
}
