import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CoreError } from './errors';
import { add, cmp, fromInt, rat, sub, ZERO, type Rational } from './rational';
import { roundLargestRemainder } from './rounding';

describe('roundLargestRemainder', () => {
  it('gives the unit to the largest remainder', () => {
    expect(
      roundLargestRemainder([rat(-1600n), rat(4100n, 3n), rat(700n, 3n), ZERO], [1, 2, 3, 4]),
    ).toEqual([-1600, 1367, 233, 0]);
  });

  it('breaks ties on equal remainders by the smaller seat order', () => {
    const values = [rat(1n, 3n), rat(1n, 3n), rat(-2n, 3n)];
    // floors 0, 0, −1, K = 1; remainders 1/3, 1/3, 1/3: seat order decides.
    expect(roundLargestRemainder(values, [1, 2, 3])).toEqual([1, 0, -1]);
    expect(roundLargestRemainder(values, [3, 2, 1])).toEqual([0, 0, 0]);
    expect(roundLargestRemainder(values, [2, 1, 3])).toEqual([0, 1, -1]);
  });

  it('supports a non-zero target sum (V2 prize pool)', () => {
    // 50/30/20 % of 333 = 166.5 / 99.9 / 66.6
    const pool = 333;
    const values = [50n, 30n, 20n].map((p) => rat(p * BigInt(pool), 100n));
    expect(roundLargestRemainder(values, [1, 2, 3], pool)).toEqual([166, 100, 67]);
  });

  it('handles empty input', () => {
    expect(roundLargestRemainder([], [])).toEqual([]);
  });

  it('rejects values that do not sum to the target and mismatched lengths', () => {
    expect(() => roundLargestRemainder([rat(1n, 2n)], [1])).toThrow(CoreError);
    expect(() => roundLargestRemainder([ZERO], [])).toThrow(CoreError);
    expect(() => roundLargestRemainder([ZERO], [1], 0.5)).toThrow(CoreError);
  });
});

/** Random fractions with an exact zero sum: the last value balances the others. */
const zeroSumArb = fc
  .array(
    fc.tuple(
      fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
      fc.bigInt({ min: 1n, max: 10n ** 6n }),
    ),
    { minLength: 0, maxLength: 30 },
  )
  .map((pairs) => {
    const values: Rational[] = pairs.map(([n, d]) => rat(n, d));
    values.push(sub(ZERO, values.reduce(add, ZERO)));
    return values;
  });

describe('roundLargestRemainder properties', () => {
  it('rounded results sum to 0 and each is within 1 of the exact value', () => {
    fc.assert(
      fc.property(zeroSumArb, (values) => {
        const rounded = roundLargestRemainder(
          values,
          values.map((_, i) => i),
        );
        expect(rounded.reduce((s, v) => s + v, 0)).toBe(0);
        rounded.forEach((r, i) => {
          const diff = sub(fromInt(r), values[i] as Rational);
          expect(cmp(diff, rat(-1n))).toBe(1);
          expect(cmp(diff, rat(1n))).toBe(-1);
        });
      }),
    );
  });
});
