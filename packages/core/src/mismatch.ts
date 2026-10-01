import { CoreError } from './errors';
import type { PlayerTotals } from './events';
import { ZERO, add, fromInt, mul, rat, type Rational } from './rational';
import type { MismatchMode, Stack } from './types';

/** Chip result of one player after the mismatch adjustment. */
export interface PlayerChipResult {
  readonly playerId: string;
  readonly seatOrder: number;
  /** Adjustment added to `out − in`: `−D·in/IN` or `−D` (exact fraction). */
  readonly adjustment: Rational;
  /** `c_i = (out − in) + adjustment` (exact fraction). */
  readonly chipResult: Rational;
}

export interface ChipResults {
  /** Chip mismatch `D = OUT − IN`; negative means chips are missing. */
  readonly mismatchChips: number;
  readonly players: PlayerChipResult[];
}

/**
 * Chip results with the mismatch distributed (SPEC §8.1, V1-FIN-04, V1-RES-01):
 * - `proportional`: `c_i = (out_i − in_i) − D·in_i/IN`;
 * - `single_player` k: `c_k = (out_k − in_k) − D`, others `c_i = out_i − in_i`.
 *
 * `Σ c_i = 0` in both modes. With `IN = 0` there is nothing to distribute and the
 * adjustment is zero.
 */
export function computeChipResults(
  totals: readonly PlayerTotals[],
  mismatch: MismatchMode,
): ChipResults {
  let totalIn = 0;
  let totalOut = 0;
  for (const t of totals) {
    totalIn += t.in;
    totalOut += t.out;
  }
  const d = totalOut - totalIn;

  if (mismatch.mode === 'single_player' && !totals.some((t) => t.playerId === mismatch.playerId)) {
    throw new CoreError(`Mismatch player ${mismatch.playerId} is not in the game`);
  }
  if (totalIn === 0 && d !== 0) {
    throw new CoreError('Chips were cashed out without any purchase');
  }

  const players = totals.map((t) => {
    let adjustment: Rational = ZERO;
    if (d !== 0) {
      if (mismatch.mode === 'proportional') {
        adjustment = rat(BigInt(-d) * BigInt(t.in), BigInt(totalIn));
      } else if (t.playerId === mismatch.playerId) {
        adjustment = fromInt(-d);
      }
    }
    const chipResult = add(fromInt(t.out - t.in), adjustment);
    return { playerId: t.playerId, seatOrder: t.seatOrder, adjustment, chipResult };
  });
  return { mismatchChips: d, players };
}

/** Throws `CoreError` unless both stack values are positive safe integers. */
export function assertValidStack(stack: Stack): void {
  if (
    !Number.isSafeInteger(stack.chips) ||
    !Number.isSafeInteger(stack.amount) ||
    stack.chips <= 0 ||
    stack.amount <= 0
  ) {
    throw new CoreError('Stack chips and amount must be positive safe integers');
  }
}

/** Exact money value of `chips`: `chips · amount / stackChips` (SPEC §8.1). */
export function chipsToMoney(chips: Rational, stack: Stack): Rational {
  assertValidStack(stack);
  return mul(chips, rat(BigInt(stack.amount), BigInt(stack.chips)));
}
