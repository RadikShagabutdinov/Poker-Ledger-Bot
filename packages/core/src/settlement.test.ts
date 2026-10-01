import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CoreError } from './errors';
import { checkManualSettlement } from './manual';
import { computeSettlement, type Balance } from './settlement';
import type { Transfer } from './types';

function balances(...amounts: number[]): Balance[] {
  return amounts.map((amount, i) => ({ playerId: `p${String(i)}`, seatOrder: i + 1, amount }));
}

function closes(input: readonly Balance[], transfers: readonly Transfer[]): boolean {
  return (
    checkManualSettlement(
      transfers,
      input.map((b) => ({ playerId: b.playerId, money: b.amount })),
    ).length === 0
  );
}

/**
 * Independent reference: minimum transfers = n − (max number of disjoint zero-sum
 * groups), found by trying every subset containing the first remaining player.
 */
function bruteForceMinTransfers(amounts: readonly number[]): number {
  const values = amounts.filter((a) => a !== 0);
  const maxGroups = (rest: readonly number[]): number => {
    if (rest.length === 0) return 0;
    const [first, ...others] = rest as [number, ...number[]];
    let best = 0;
    for (let mask = 0; mask < 1 << others.length; mask++) {
      let sum = first;
      const remaining: number[] = [];
      others.forEach((v, i) => {
        if (mask & (1 << i)) sum += v;
        else remaining.push(v);
      });
      if (sum === 0) best = Math.max(best, 1 + maxGroups(remaining));
    }
    return best;
  };
  return values.length - maxGroups(values);
}

describe('computeSettlement', () => {
  it('drops zero balances and returns nothing for all zeros', () => {
    expect(computeSettlement(balances(0, 0, 0))).toEqual([]);
    expect(computeSettlement([])).toEqual([]);
  });

  it('uses zero-sum subgroups to save transfers', () => {
    // {−5, +5} and {−3, −4, +7}: 1 + 2 = 3 transfers instead of 4.
    const input = balances(-5, -3, 7, 5, -4);
    const transfers = computeSettlement(input);
    expect(transfers).toEqual([
      { from: 'p0', to: 'p3', amount: 5 },
      { from: 'p1', to: 'p2', amount: 3 },
      { from: 'p4', to: 'p2', amount: 4 },
    ]);
  });

  it('breaks greedy ties by seat order and sorts by payer, then amount descending', () => {
    // Equal debts: the earlier seat pays first; equal claims: the earlier seat receives first.
    expect(computeSettlement(balances(-10, -10, 7, 13))).toEqual([
      { from: 'p0', to: 'p3', amount: 10 },
      { from: 'p1', to: 'p2', amount: 7 },
      { from: 'p1', to: 'p3', amount: 3 },
    ]);
    const shuffled = [...balances(-10, -10, 7, 13)].reverse();
    expect(computeSettlement(shuffled)).toEqual(computeSettlement(balances(-10, -10, 7, 13)));
  });

  it('uses one greedy group above 20 players', () => {
    // 11 pairs {−k, +k}: the DP would find 11 groups (11 transfers); greedy over one group
    // still closes everything with at most n − 1 transfers.
    const amounts = Array.from({ length: 11 }, (_, i) => [-(i + 1), i + 1]).flat();
    const input = balances(...amounts);
    const transfers = computeSettlement(input);
    expect(closes(input, transfers)).toBe(true);
    expect(transfers.length).toBeLessThanOrEqual(21);
  });

  it('settles 20 players optimally in well under a second', () => {
    // 10 pairs {−k, +k}: every zero-sum group needs ≥ 2 players, so 10 groups and
    // 10 transfers is the optimum; the DP has to find it over 2^20 masks.
    const amounts = Array.from({ length: 10 }, (_, i) => [-(i + 1) * 101, (10 - i) * 101]).flat();
    const input = balances(...amounts);
    const started = performance.now();
    const transfers = computeSettlement(input);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(closes(input, transfers)).toBe(true);
    expect(transfers).toHaveLength(10);
  });

  it('rejects unbalanced or non-integer input', () => {
    expect(() => computeSettlement(balances(1, -2))).toThrow(CoreError);
    expect(() => computeSettlement(balances(0.5, -0.5))).toThrow(CoreError);
    expect(() =>
      computeSettlement(balances(Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER)),
    ).toThrow(CoreError);
  });
});

const balancesArb = (maxLength: number, maxAbs: number) =>
  fc
    .array(fc.integer({ min: -maxAbs, max: maxAbs }), { minLength: 0, maxLength })
    .map((amounts) => {
      amounts.push(-amounts.reduce((s, v) => s + v, 0));
      return amounts;
    });

describe('computeSettlement properties', () => {
  it('closes every balance with positive amounts and at most n − 1 transfers', () => {
    fc.assert(
      fc.property(balancesArb(25, 1_000_000), (amounts) => {
        const input = balances(...amounts);
        const transfers = computeSettlement(input);
        expect(closes(input, transfers)).toBe(true);
        expect(
          transfers.every((t) => Number.isSafeInteger(t.amount) && t.amount > 0 && t.from !== t.to),
        ).toBe(true);
        const n = amounts.filter((a) => a !== 0).length;
        expect(transfers.length).toBeLessThanOrEqual(Math.max(n - 1, 0));
      }),
    );
  });

  it('is optimal for n ≤ 8 (matches brute force)', () => {
    // Small amounts make zero-sum subgroups frequent.
    fc.assert(
      fc.property(balancesArb(7, 6), (amounts) => {
        expect(computeSettlement(balances(...amounts)).length).toBe(
          bruteForceMinTransfers(amounts),
        );
      }),
      { numRuns: 500 },
    );
  });
});
