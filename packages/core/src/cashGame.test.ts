import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { computeCashGameResult, type CashGameInput, type CashGameResult } from './cashGame';
import { CoreError } from './errors';
import { checkManualSettlement } from './manual';
import { chipsToMoney, chipsToMoneyRounded, computeChipResults } from './mismatch';
import { fromInt, rat } from './rational';
import { log, seat } from './testUtils';
import type { CoreEvent } from './types';

const stack = { chips: 30_000, amount: 1_000 };
const players = seat('vasya', 'petya', 'kolya', 'dima');
const purchases = log(
  ['vasya', 'buy_in', 30_000],
  ['petya', 'buy_in', 30_000],
  ['kolya', 'buy_in', 30_000],
  ['dima', 'buy_in', 30_000],
  ['vasya', 'rebuy', 30_000],
  ['kolya', 'rebuy', 15_000],
);

function compute(input: Partial<CashGameInput>): CashGameResult {
  const result = computeCashGameResult({
    players,
    events: purchases,
    stack,
    mismatch: { mode: 'proportional' },
    ...input,
  });
  if (!result.ok) {
    throw new Error(`unexpected error ${result.error.code}`);
  }
  return result.value;
}

const money = (r: CashGameResult) => r.players.map((p) => p.moneyResult);

describe('SPEC §8.5: no mismatch', () => {
  const result = compute({
    finalChips: { vasya: 12_000, petya: 71_000, kolya: 52_000, dima: 30_000 },
  });

  it('rounds results to a zero sum', () => {
    expect(money(result)).toEqual([-1600, 1367, 233, 0]);
    expect(result.mismatchChips).toBe(0);
    expect(result.players.map((p) => p.adjustmentChips)).toEqual(
      Array.from({ length: 4 }, () => ({ num: 0, den: 1 })),
    );
  });

  it('builds the transfers', () => {
    expect(result.transfers).toEqual([
      { from: 'vasya', to: 'petya', amount: 1367 },
      { from: 'vasya', to: 'kolya', amount: 233 },
    ]);
  });

  it('applies final chips as cash-outs', () => {
    expect(result.summary).toEqual({
      issuedChips: 165_000,
      cashedOutChips: 165_000,
      expectedOnTable: 0,
      seatedCount: 0,
    });
    expect(result.players[0]).toMatchObject({
      in: 60_000,
      out: 12_000,
      buyinCount: 1,
      rebuyCount: 1,
    });
  });

  it('gives the same result when cash-outs are recorded as events', () => {
    const events = [
      ...purchases,
      ...log(
        ['vasya', 'cash_out', 12_000],
        ['petya', 'cash_out', 71_000],
        ['kolya', 'cash_out', 52_000],
        ['dima', 'cash_out', 30_000],
      ).map((e) => ({ ...e, id: e.id + 100 })),
    ];
    expect(compute({ events })).toEqual(result);
  });
});

describe('SPEC §8.6: proportional mismatch', () => {
  const result = compute({
    finalChips: { vasya: 12_000, petya: 71_000, kolya: 52_000, dima: 29_000 },
  });

  it('distributes D = −1000 proportionally to chips bought', () => {
    expect(result.mismatchChips).toBe(-1000);
    // +363.64 / +181.82 / +272.73 / +181.82
    expect(result.players.map((p) => p.adjustmentChips)).toEqual([
      { num: 4000, den: 11 },
      { num: 2000, den: 11 },
      { num: 3000, den: 11 },
      { num: 2000, den: 11 },
    ]);
  });

  it('has exactly equal remainders 8/11 for Petya and Dima', () => {
    const exact = result.players.map((p) => chipsToMoney(p.chipResult, stack));
    expect(exact).toEqual([
      rat(-52_400n, 33n), // −1587.88, remainder 4/33
      rat(15_100n, 11n), // 1372.73, remainder 8/11
      rat(8_000n, 33n), // 242.42, remainder 14/33
      rat(-300n, 11n), // −27.27, remainder 8/11
    ]);
  });

  it('rounds and settles', () => {
    expect(money(result)).toEqual([-1588, 1373, 242, -27]);
    expect(result.transfers).toEqual([
      { from: 'vasya', to: 'petya', amount: 1373 },
      { from: 'vasya', to: 'kolya', amount: 215 },
      { from: 'dima', to: 'kolya', amount: 27 },
    ]);
  });
});

describe('computeCashGameResult edge cases', () => {
  it('handles an empty game', () => {
    const result = compute({ events: [] });
    expect(money(result)).toEqual([0, 0, 0, 0]);
    expect(result.transfers).toEqual([]);
    expect(result.summary.issuedChips).toBe(0);
  });

  it('handles a game without players', () => {
    const result = compute({ players: [], events: [] });
    expect(result.players).toEqual([]);
    expect(result.transfers).toEqual([]);
  });

  it('handles a single player with a mismatch', () => {
    const result = compute({
      players: seat('a'),
      events: log(['a', 'buy_in', 30_000]),
      finalChips: { a: 25_000 },
    });
    expect(result.mismatchChips).toBe(-5000);
    expect(money(result)).toEqual([0]);
    expect(result.transfers).toEqual([]);
  });

  it('handles everybody at zero', () => {
    const result = compute({
      finalChips: { vasya: 60_000, petya: 30_000, kolya: 45_000, dima: 30_000 },
    });
    expect(money(result)).toEqual([0, 0, 0, 0]);
    expect(result.transfers).toEqual([]);
  });

  it('puts the whole mismatch on one player', () => {
    const result = compute({
      finalChips: { vasya: 12_000, petya: 71_000, kolya: 52_000, dima: 29_000 },
      mismatch: { mode: 'single_player', playerId: 'dima' },
    });
    expect(result.players.map((p) => p.adjustmentChips)).toEqual([
      { num: 0, den: 1 },
      { num: 0, den: 1 },
      { num: 0, den: 1 },
      { num: 1000, den: 1 },
    ]);
    // Dima: 29 000 − 30 000 + 1 000 = 0 chips
    expect(money(result)).toEqual([-1600, 1367, 233, 0]);
  });

  it('includes re-entries in the totals', () => {
    const result = compute({
      players: seat('a', 'b'),
      events: log(
        ['a', 'buy_in', 30_000],
        ['a', 'cash_out', 0],
        ['a', 'buy_in', 30_000],
        ['b', 'buy_in', 30_000],
      ),
      finalChips: { a: 0, b: 90_000 },
    });
    expect(result.players[0]).toMatchObject({ in: 60_000, buyinCount: 2, moneyResult: -2000 });
    expect(result.transfers).toEqual([{ from: 'a', to: 'b', amount: 2000 }]);
  });

  it('requires final chips for every seated player (V1-FIN-05)', () => {
    const result = computeCashGameResult({
      players,
      events: purchases,
      stack,
      mismatch: { mode: 'proportional' },
      finalChips: { petya: 1 },
    });
    expect(result).toEqual({
      ok: false,
      error: { code: 'MISSING_FINAL_CHIPS', playerIds: ['vasya', 'kolya', 'dima'] },
    });
  });

  it('rejects final chips for players who are not seated or invalid values', () => {
    const base = { players, stack, mismatch: { mode: 'proportional' as const } };
    expect(
      computeCashGameResult({
        ...base,
        events: log(['vasya', 'buy_in', 1]),
        finalChips: { vasya: 1, petya: 0 },
      }),
    ).toEqual({ ok: false, error: { code: 'INVALID_FINAL_CHIPS', playerIds: ['petya'] } });
    expect(
      computeCashGameResult({
        ...base,
        events: log(['vasya', 'buy_in', 1]),
        finalChips: { vasya: -1 },
      }),
    ).toEqual({ ok: false, error: { code: 'INVALID_FINAL_CHIPS', playerIds: ['vasya'] } });
  });

  it('rejects an invalid event sequence and an unknown mismatch player', () => {
    const base = { players, stack, mismatch: { mode: 'proportional' as const } };
    expect(computeCashGameResult({ ...base, events: log(['vasya', 'rebuy', 1]) })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_EVENT_SEQUENCE', eventId: 1 },
    });
    expect(
      computeCashGameResult({
        ...base,
        events: [],
        mismatch: { mode: 'single_player', playerId: 'x' },
      }),
    ).toEqual({ ok: false, error: { code: 'INVALID_MISMATCH_PLAYER' } });
  });

  it('throws on an invalid stack', () => {
    expect(() => compute({ stack: { chips: 0, amount: 1000 } })).toThrow(CoreError);
    expect(() => compute({ stack: { chips: 100, amount: 1.5 } })).toThrow(CoreError);
  });
});

describe('computeChipResults guards', () => {
  const totals = [
    {
      playerId: 'a',
      seatOrder: 1,
      in: 0,
      out: 10,
      buyinCount: 0,
      rebuyCount: 0,
      status: 'left' as const,
    },
  ];

  it('throws when chips were cashed out without purchases', () => {
    expect(() => computeChipResults(totals, { mode: 'proportional' })).toThrow(CoreError);
  });

  it('throws for an unknown mismatch player', () => {
    expect(() => computeChipResults(totals, { mode: 'single_player', playerId: 'x' })).toThrow(
      CoreError,
    );
  });
});

describe('chipsToMoney', () => {
  it('converts exactly for preliminary results (V1-PLAY-03)', () => {
    expect(chipsToMoney(fromInt(-48_000), stack)).toEqual(rat(-1600n));
    expect(chipsToMoney(fromInt(41_000), stack)).toEqual(rat(4100n, 3n));
  });

  it('rounds to the nearest unit, halves up', () => {
    expect(chipsToMoneyRounded(41_000, stack)).toBe(1367);
    expect(chipsToMoneyRounded(-41_000, stack)).toBe(-1367);
    expect(chipsToMoneyRounded(15, stack)).toBe(1); // 0.5
    expect(chipsToMoneyRounded(-15, stack)).toBe(0); // −0.5
    expect(chipsToMoneyRounded(0, stack)).toBe(0);
  });
});

/** Random valid games: each player buys in, rebuys some times, maybe re-enters. */
const gameArb = fc
  .record({
    stackChips: fc.integer({ min: 1, max: 100_000 }),
    stackAmount: fc.integer({ min: 1, max: 100_000 }),
    players: fc.array(
      fc.record({
        buys: fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 4 }),
        out: fc.integer({ min: 0, max: 3_000_000 }),
      }),
      { minLength: 1, maxLength: 12 },
    ),
    single: fc.option(fc.nat()),
  })
  .map(({ stackChips, stackAmount, players: specs, single }) => {
    const ps = seat(...specs.map((_, i) => `p${String(i)}`));
    const events: CoreEvent[] = [];
    specs.forEach((spec, i) => {
      spec.buys.forEach((chips, j) => {
        events.push({
          id: events.length + 1,
          playerId: `p${String(i)}`,
          type: j === 0 ? 'buy_in' : 'rebuy',
          chips,
          cancelled: false,
        });
      });
    });
    const finalChips = Object.fromEntries(specs.map((s, i) => [`p${String(i)}`, s.out]));
    const mismatch =
      single === null
        ? ({ mode: 'proportional' } as const)
        : ({ mode: 'single_player', playerId: `p${String(single % specs.length)}` } as const);
    return {
      players: ps,
      events,
      finalChips,
      mismatch,
      stack: { chips: stackChips, amount: stackAmount },
    };
  });

describe('computeCashGameResult properties', () => {
  it('money results sum to 0 and the transfers close every balance', () => {
    fc.assert(
      fc.property(gameArb, (input) => {
        const result = computeCashGameResult(input);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const results = result.value.players.map((p) => ({
          playerId: p.playerId,
          money: p.moneyResult,
        }));
        expect(results.reduce((s, r) => s + r.money, 0)).toBe(0);
        expect(checkManualSettlement(result.value.transfers, results)).toEqual([]);
        expect(result.value.summary.expectedOnTable).toBe(-result.value.mismatchChips);
      }),
    );
  });
});
