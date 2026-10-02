import {
  computeCashGameResult,
  type CashGameError,
  type CashGameResult,
  type MismatchMode,
} from '@pokerledger/core';

import type { DbOrTx } from '../db/client';
import { listGameResults, replaceGameResults } from '../db/repositories/gameResults';
import { updateGame } from '../db/repositories/games';
import { replaceSettlement } from '../db/repositories/settlements';
import type { GameRow } from '../db/schema';
import { ServiceError } from './errors';
import { loadGameData, toCoreView, type CoreView, type GameData } from './gameData';

/** What to do with a manual settlement when results change. */
export type SettlementPolicy = 'recalculate' | 'keep';

export function mismatchOf(game: GameRow): MismatchMode {
  return game.mismatchMode === 'single_player' && game.mismatchPlayerId !== null
    ? { mode: 'single_player', playerId: game.mismatchPlayerId }
    : { mode: 'proportional' };
}

/** Turns a core error into a service error with stored event ids. */
export function cashGameError(error: CashGameError, view: CoreView): ServiceError {
  switch (error.code) {
    case 'INVALID_EVENT_SEQUENCE':
      return new ServiceError('INVALID_EVENT_SEQUENCE', {
        eventId: view.fromCore(error.eventId),
        reason: error.reason,
      });
    case 'MISSING_FINAL_CHIPS':
    case 'INVALID_FINAL_CHIPS':
      return new ServiceError(error.code, { playerIds: error.playerIds });
    case 'INVALID_MISMATCH_PLAYER':
      return new ServiceError('INVALID_MISMATCH_PLAYER');
  }
}

/** Full cash-game calculation of stored events; throws mapped errors. */
export function computeResult(
  data: GameData,
  mismatch: MismatchMode,
  finalChips?: Readonly<Record<string, number>>,
): CashGameResult {
  const view = toCoreView(data);
  const result = computeCashGameResult({
    players: view.players,
    events: view.events,
    stack: { chips: data.game.stackChips, amount: data.game.stackAmount },
    mismatch,
    ...(finalChips ? { finalChips } : {}),
  });
  if (!result.ok) {
    throw cashGameError(result.error, view);
  }
  return result.value;
}

function writeResults(db: DbOrTx, gameId: string, result: CashGameResult): void {
  replaceGameResults(
    db,
    gameId,
    result.players.map((p) => ({
      gameId,
      playerId: p.playerId,
      inChips: p.in,
      outChips: p.out,
      buyinCount: p.buyinCount,
      rebuyCount: p.rebuyCount,
      adjustmentChipsNum: p.adjustmentChips.num,
      adjustmentChipsDen: p.adjustmentChips.den,
      moneyResult: p.moneyResult,
      place: null,
      prize: null,
      paidTotal: null,
    })),
  );
}

/**
 * Stores the results of a game whose players have all left: `game_results`,
 * `mismatch_chips` and the automatic settlement (finish).
 */
export function storeFinishedResults(db: DbOrTx, game: GameRow): CashGameResult {
  const result = computeResult(loadGameData(db, game), mismatchOf(game));
  writeResults(db, game.id, result);
  replaceSettlement(db, game.id, result.transfers);
  updateGame(db, game.id, { mismatchChips: result.mismatchChips, settlementIsManual: false });
  return result;
}

/**
 * Recalculates a finished game after an edit. An automatic
 * settlement is rebuilt. A manual one is kept when money results did not change;
 * otherwise `policy` decides, and without it the edit is rejected.
 */
export function recalculateFinishedGame(
  db: DbOrTx,
  game: GameRow,
  policy: SettlementPolicy | undefined,
): CashGameResult {
  const before = new Map(listGameResults(db, game.id).map((r) => [r.playerId, r.moneyResult]));
  const result = computeResult(loadGameData(db, game), mismatchOf(game));
  const moneyChanged =
    before.size !== result.players.length ||
    result.players.some((p) => before.get(p.playerId) !== p.moneyResult);

  writeResults(db, game.id, result);
  updateGame(db, game.id, { mismatchChips: result.mismatchChips });

  if (!game.settlementIsManual) {
    replaceSettlement(db, game.id, result.transfers);
  } else if (moneyChanged) {
    if (policy === undefined) {
      throw new ServiceError('VALIDATION', { reason: 'SETTLEMENT_POLICY_REQUIRED' });
    }
    if (policy === 'recalculate') {
      replaceSettlement(db, game.id, result.transfers);
      updateGame(db, game.id, { settlementIsManual: false });
    }
  }
  return result;
}
