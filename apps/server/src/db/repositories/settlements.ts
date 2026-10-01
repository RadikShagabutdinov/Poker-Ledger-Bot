import { eq } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { settlements, type SettlementRow } from '../schema';

export interface TransferRow {
  readonly from: string;
  readonly to: string;
  readonly amount: number;
}

/** Transfers of a game in display order. */
export function listSettlement(db: DbOrTx, gameId: string): SettlementRow[] {
  return db
    .select()
    .from(settlements)
    .where(eq(settlements.gameId, gameId))
    .orderBy(settlements.position)
    .all();
}

export function replaceSettlement(
  db: DbOrTx,
  gameId: string,
  transfers: readonly TransferRow[],
): void {
  deleteSettlement(db, gameId);
  if (transfers.length > 0) {
    db.insert(settlements)
      .values(
        transfers.map((t, position) => ({
          gameId,
          fromPlayerId: t.from,
          toPlayerId: t.to,
          amount: t.amount,
          position,
        })),
      )
      .run();
  }
}

export function deleteSettlement(db: DbOrTx, gameId: string): void {
  db.delete(settlements).where(eq(settlements.gameId, gameId)).run();
}
