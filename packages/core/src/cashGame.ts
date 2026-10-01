import { type Result } from './errors';
import {
  computePlayerTotals,
  computeSummary,
  validateEventSequence,
  type GameSummary,
  type PlayerTotals,
  type SequenceError,
} from './events';
import { assertValidStack, chipsToMoney, computeChipResults } from './mismatch';
import { toSafeInt, type Rational } from './rational';
import { roundLargestRemainder } from './rounding';
import { computeSettlement } from './settlement';
import type { CoreEvent, CorePlayer, MismatchMode, Stack, Transfer } from './types';

export interface CashGameInput {
  readonly players: readonly CorePlayer[];
  readonly events: readonly CoreEvent[];
  readonly stack: Stack;
  /**
   * Chips counted at the end for players who are still seated (V1-FIN-02).
   * Applied as a final `cash_out` of each of them. Required for every seated player.
   */
  readonly finalChips?: Readonly<Record<string, number>>;
  readonly mismatch: MismatchMode;
}

/** Result of one player, ready to store in `game_results`. */
export interface CashGamePlayerResult extends PlayerTotals {
  /** Mismatch adjustment in chips as a reduced fraction (`adjustment_chips_num/den`). */
  readonly adjustmentChips: { readonly num: number; readonly den: number };
  /** Exact chip result `c_i`. */
  readonly chipResult: Rational;
  /** Money result rounded so that the results sum to 0 (V1-RES-02). */
  readonly moneyResult: number;
}

export interface CashGameResult {
  /** Summary after the final chips are applied. */
  readonly summary: GameSummary;
  /** Chip mismatch `D = OUT − IN`. */
  readonly mismatchChips: number;
  /** Players in the input order. */
  readonly players: CashGamePlayerResult[];
  /** Automatic settlement with the minimum number of transfers. */
  readonly transfers: Transfer[];
}

export type CashGameError =
  | SequenceError
  | { readonly code: 'MISSING_FINAL_CHIPS'; readonly playerIds: string[] }
  | { readonly code: 'INVALID_FINAL_CHIPS'; readonly playerIds: string[] }
  | { readonly code: 'INVALID_MISMATCH_PLAYER' };

/**
 * Full cash-game calculation (SPEC §8): totals, chip mismatch and its adjustment,
 * money results rounded to a zero sum, and the automatic settlement. Used for the
 * finish preview, the finish itself and recalculation of a finished game.
 */
export function computeCashGameResult(input: CashGameInput): Result<CashGameResult, CashGameError> {
  const { players, stack, mismatch, finalChips = {} } = input;
  assertValidStack(stack);

  const sequence = validateEventSequence(players, input.events);
  if (!sequence.ok) {
    return sequence;
  }
  if (mismatch.mode === 'single_player' && !players.some((p) => p.id === mismatch.playerId)) {
    return { ok: false, error: { code: 'INVALID_MISMATCH_PLAYER' } };
  }

  // Final chips become cash-outs after every recorded event, in seat order.
  const seated = computePlayerTotals(players, input.events)
    .filter((t) => t.status === 'seated')
    .sort((a, b) => a.seatOrder - b.seatOrder);
  const seatedIds = new Set(seated.map((t) => t.playerId));
  const invalid = Object.entries(finalChips)
    .filter(([id, chips]) => !seatedIds.has(id) || !Number.isSafeInteger(chips) || chips < 0)
    .map(([id]) => id);
  if (invalid.length > 0) {
    return { ok: false, error: { code: 'INVALID_FINAL_CHIPS', playerIds: invalid } };
  }
  const missing = seated.filter((t) => finalChips[t.playerId] === undefined).map((t) => t.playerId);
  if (missing.length > 0) {
    return { ok: false, error: { code: 'MISSING_FINAL_CHIPS', playerIds: missing } };
  }

  let nextId = input.events.reduce((max, e) => Math.max(max, e.id), 0);
  const events: CoreEvent[] = [
    ...input.events,
    ...seated.map((t) => ({
      id: ++nextId,
      playerId: t.playerId,
      type: 'cash_out' as const,
      chips: finalChips[t.playerId] as number,
      cancelled: false,
    })),
  ];

  const totals = computePlayerTotals(players, events);
  const chips = computeChipResults(totals, mismatch);
  const money = roundLargestRemainder(
    chips.players.map((p) => chipsToMoney(p.chipResult, stack)),
    chips.players.map((p) => p.seatOrder),
  );

  const results = totals.map((t, i): CashGamePlayerResult => {
    const c = chips.players[i] as (typeof chips.players)[number];
    return {
      ...t,
      adjustmentChips: {
        num: toSafeInt(c.adjustment.num, 'adjustment numerator'),
        den: toSafeInt(c.adjustment.den, 'adjustment denominator'),
      },
      chipResult: c.chipResult,
      moneyResult: money[i] as number,
    };
  });

  return {
    ok: true,
    value: {
      summary: computeSummary(totals),
      mismatchChips: chips.mismatchChips,
      players: results,
      transfers: computeSettlement(
        results.map((r) => ({
          playerId: r.playerId,
          seatOrder: r.seatOrder,
          amount: r.moneyResult,
        })),
      ),
    },
  };
}
