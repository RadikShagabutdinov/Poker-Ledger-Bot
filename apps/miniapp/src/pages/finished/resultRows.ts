// Result rows of the finish preview and of a finished game.
import {
  add,
  computeChipResults,
  floor,
  rat,
  toSafeInt,
  type MismatchMode,
  type Rational,
} from '@pokerledger/core';
import type { GameStateResponse } from '@pokerledger/shared';

export interface ResultRow {
  readonly playerId: string;
  readonly inChips: number;
  readonly outChips: number;
  /** `out − in` plus the mismatch adjustment, rounded for display. */
  readonly chipResult: number;
  readonly moneyResult: number;
}

/** Nearest integer, halves up; for showing exact fractions such as adjusted chips. */
export function roundForDisplay(value: Rational): number {
  return toSafeInt(floor(add(value, rat(1n, 2n))), 'display value');
}

/** Result rows of a finished game; the adjusted chips are recomputed by core from the totals. */
export function finishedResultRows(game: GameStateResponse): ResultRow[] {
  const players = game.players.filter((p) => p.moneyResult !== null);
  const mismatch: MismatchMode =
    game.mismatch?.mode === 'single_player' && game.mismatch.playerId !== null
      ? { mode: 'single_player', playerId: game.mismatch.playerId }
      : { mode: 'proportional' };
  const chips = computeChipResults(
    players.map((p) => ({
      playerId: p.playerId,
      seatOrder: p.seatOrder,
      in: p.inChips,
      out: p.outChips,
      buyinCount: p.buyinCount,
      rebuyCount: p.rebuyCount,
      status: p.status,
    })),
    mismatch,
  ).players;
  return players.map((p, index) => ({
    playerId: p.playerId,
    inChips: p.inChips,
    outChips: p.outChips,
    chipResult: roundForDisplay(chips[index]?.chipResult ?? rat(0n)),
    moneyResult: p.moneyResult ?? 0,
  }));
}
