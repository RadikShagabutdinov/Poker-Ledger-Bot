import { CoreError, assertSafeInt } from './errors';
import { add, cmp, floor, fromInt, rat, sub, toSafeInt, ZERO, type Rational } from './rational';

/**
 * Rounds exact values to integers whose sum is exactly `targetSum`, by the
 * largest remainder method:
 * 1. `f_i = floor(v_i)` toward −∞;
 * 2. `r_i = v_i − f_i` in [0, 1);
 * 3. `K = targetSum − Σ f_i`;
 * 4. +1 to the `K` values with the largest remainders; on equal remainders the
 *    smaller `tieOrder` (seat order) wins.
 *
 * `Σ v_i` must equal `targetSum` exactly (0 for game results; the prize pool for
 * tournament payouts in V2). Each result differs from its exact value by less than 1.
 */
export function roundLargestRemainder(
  values: readonly Rational[],
  tieOrder: readonly number[],
  targetSum = 0,
): number[] {
  if (values.length !== tieOrder.length) {
    throw new CoreError('values and tieOrder must have the same length');
  }
  assertSafeInt(targetSum, 'targetSum');
  const total = values.reduce(add, ZERO);
  if (cmp(total, fromInt(targetSum)) !== 0) {
    throw new CoreError('Values must sum to targetSum exactly');
  }

  const floors = values.map(floor);
  const remainders = values.map((v, i) => sub(v, rat(floors[i] as bigint)));
  const k = BigInt(targetSum) - floors.reduce((s, f) => s + f, 0n);

  const order = values.map((_, i) => i);
  order.sort(
    (a, b) =>
      cmp(remainders[b] as Rational, remainders[a] as Rational) ||
      (tieOrder[a] as number) - (tieOrder[b] as number) ||
      a - b,
  );
  const result = floors.slice();
  for (let j = 0; j < Number(k); j++) {
    const i = order[j] as number;
    result[i] = (result[i] as bigint) + 1n;
  }
  return result.map((v) => toSafeInt(v, 'rounded value'));
}
