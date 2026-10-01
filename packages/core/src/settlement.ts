import { CoreError, assertSafeInt } from './errors';
import type { Transfer } from './types';

/** Money balance of a player: positive receives, negative pays. */
export interface Balance {
  readonly playerId: string;
  readonly seatOrder: number;
  readonly amount: number;
}

/** Above this many non-zero balances the exact subset DP is skipped (SPEC §8.3). */
export const EXACT_SETTLEMENT_MAX_PLAYERS = 20;

interface Entry {
  readonly playerId: string;
  readonly seatOrder: number;
  amount: number;
}

function bySeat(a: { seatOrder: number }, b: { seatOrder: number }): number {
  return a.seatOrder - b.seatOrder;
}

/**
 * Splits players into the maximum number of disjoint zero-sum groups with the
 * subset DP: `dp[mask] = max_i dp[mask \ i] + (sum[mask] == 0)`. Entries must be
 * sorted by seat order: the reconstruction prefers the smallest index.
 */
function splitZeroSumGroups(entries: readonly Entry[]): Entry[][] {
  const n = entries.length;
  const size = 1 << n;
  // Subset sums of integers; the caller guarantees Σ|b_i| ≤ MAX_SAFE_INTEGER,
  // so every sum is an exact integer in a double.
  const sum = new Float64Array(size);
  const dp = new Uint8Array(size);
  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    sum[mask] = (sum[mask ^ low] as number) + (entries[31 - Math.clz32(low)] as Entry).amount;
    let best = 0;
    for (let rest = mask; rest !== 0; rest &= rest - 1) {
      const v = dp[mask ^ (rest & -rest)] as number;
      if (v > best) {
        best = v;
      }
    }
    dp[mask] = best + (sum[mask] === 0 ? 1 : 0);
  }

  // Walk from the full mask to the empty one; reversing the removal order gives
  // a permutation whose zero-sum prefixes are exactly the chain's zero-sum masks.
  const removed: number[] = [];
  let mask = size - 1;
  while (mask !== 0) {
    const target = (dp[mask] as number) - (sum[mask] === 0 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const bit = 1 << i;
      if (mask & bit && dp[mask ^ bit] === target) {
        removed.push(i);
        mask ^= bit;
        break;
      }
    }
  }
  removed.reverse();

  const groups: Entry[][] = [];
  let current: Entry[] = [];
  let prefix = 0;
  for (const i of removed) {
    const entry = entries[i] as Entry;
    current.push(entry);
    prefix += entry.amount;
    if (prefix === 0) {
      groups.push(current);
      current = [];
    }
  }
  return groups;
}

/**
 * Greedy settlement inside one zero-sum group: the largest debtor pays the largest
 * creditor `min(debt, claim)`; ties go to the smaller seat order. A group without
 * zero-sum subgroups is settled with exactly `size − 1` transfers.
 */
function settleGreedy(group: readonly Entry[], out: Transfer[]): void {
  const left = group.map((e) => ({ ...e })).sort(bySeat);
  const pick = (sign: 1 | -1): Entry | undefined => {
    let best: Entry | undefined;
    for (const e of left) {
      if (e.amount * sign > 0 && (!best || e.amount * sign > best.amount * sign)) {
        best = e;
      }
    }
    return best;
  };
  for (;;) {
    const debtor = pick(-1);
    const creditor = pick(1);
    if (!debtor || !creditor) {
      return;
    }
    const amount = Math.min(-debtor.amount, creditor.amount);
    out.push({ from: debtor.playerId, to: creditor.playerId, amount });
    debtor.amount += amount;
    creditor.amount -= amount;
  }
}

/**
 * Settlement with the minimum number of transfers (SPEC §8.3, V1-SETL-01).
 * Balances must be safe integers summing to 0. Zero balances are dropped; for at
 * most 20 remaining players the exact subset DP splits them into zero-sum groups,
 * otherwise all of them form one group (at most n − 1 transfers). Output is sorted
 * by payer seat order, then by amount descending, then by receiver seat order.
 */
export function computeSettlement(balances: readonly Balance[]): Transfer[] {
  let total = 0;
  let absTotal = 0;
  for (const b of balances) {
    assertSafeInt(b.amount, 'balance');
    assertSafeInt(b.seatOrder, 'seatOrder');
    total += b.amount;
    absTotal += Math.abs(b.amount);
    assertSafeInt(absTotal, 'sum of balances');
  }
  if (total !== 0) {
    throw new CoreError('Balances must sum to zero');
  }

  const entries: Entry[] = balances
    .filter((b) => b.amount !== 0)
    .map((b) => ({ playerId: b.playerId, seatOrder: b.seatOrder, amount: b.amount }))
    .sort(bySeat);
  const groups =
    entries.length <= EXACT_SETTLEMENT_MAX_PLAYERS ? splitZeroSumGroups(entries) : [entries];

  const transfers: Transfer[] = [];
  for (const group of groups) {
    settleGreedy(group, transfers);
  }

  const seat = new Map(entries.map((e) => [e.playerId, e.seatOrder]));
  const seatOf = (id: string) => seat.get(id) as number;
  return transfers.sort(
    (a, b) => seatOf(a.from) - seatOf(b.from) || b.amount - a.amount || seatOf(a.to) - seatOf(b.to),
  );
}
