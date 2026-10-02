import { describe, expect, it } from 'vitest';

import { CoreError } from './errors';
import {
  canCancelEvent,
  computePlayerTotals,
  computeSummary,
  inferBuyType,
  validateEventSequence,
  validateNewEvent,
} from './events';
import { log, seat } from './testUtils';
import type { CoreEvent } from './types';

const players = seat('a', 'b', 'c');

describe('computePlayerTotals', () => {
  it('sums purchases and cash-outs and derives statuses', () => {
    const events = log(
      ['a', 'buy_in', 100],
      ['b', 'buy_in', 100],
      ['a', 'rebuy', 50],
      ['b', 'cash_out', 30],
    );
    expect(computePlayerTotals(players, events)).toEqual([
      {
        playerId: 'a',
        seatOrder: 1,
        in: 150,
        out: 0,
        buyinCount: 1,
        rebuyCount: 1,
        status: 'seated',
      },
      {
        playerId: 'b',
        seatOrder: 2,
        in: 100,
        out: 30,
        buyinCount: 1,
        rebuyCount: 0,
        status: 'left',
      },
      {
        playerId: 'c',
        seatOrder: 3,
        in: 0,
        out: 0,
        buyinCount: 0,
        rebuyCount: 0,
        status: 'not_joined',
      },
    ]);
  });

  it('counts a re-entry after leaving as a new buy-in', () => {
    const events = log(
      ['a', 'buy_in', 100],
      ['a', 'cash_out', 0],
      ['a', 'buy_in', 100],
      ['a', 'rebuy', 100],
      ['a', 'cash_out', 250],
    );
    expect(computePlayerTotals(seat('a'), events)[0]).toMatchObject({
      in: 300,
      out: 250,
      buyinCount: 2,
      rebuyCount: 1,
      status: 'left',
    });
  });

  it('ignores cancelled and non-chip events and processes events by id', () => {
    const events: CoreEvent[] = [
      { id: 5, playerId: 'a', type: 'rebuy', chips: 10, cancelled: false },
      { id: 1, playerId: null, type: 'game_created', chips: null, cancelled: false },
      { id: 3, playerId: 'a', type: 'buy_in', chips: 100, cancelled: false },
      { id: 4, playerId: 'a', type: 'rebuy', chips: 999, cancelled: true },
      { id: 2, playerId: 'a', type: 'player_added', chips: null, cancelled: false },
    ];
    expect(computePlayerTotals(seat('a'), events)[0]).toMatchObject({ in: 110, rebuyCount: 1 });
  });

  it('throws on an invalid stored sequence', () => {
    expect(() => computePlayerTotals(players, log(['a', 'rebuy', 10]))).toThrow(CoreError);
  });

  it('rejects non-integer seat order', () => {
    expect(() => computePlayerTotals([{ id: 'a', seatOrder: 1.5 }], [])).toThrow(CoreError);
  });
});

describe('computeSummary', () => {
  it('reports issued, cashed out, expected on table and seated count', () => {
    const events = log(['a', 'buy_in', 100], ['b', 'buy_in', 200], ['b', 'cash_out', 50]);
    expect(computeSummary(computePlayerTotals(players, events))).toEqual({
      issuedChips: 300,
      cashedOutChips: 50,
      expectedOnTable: 250,
      seatedCount: 1,
    });
  });
});

describe('validateEventSequence', () => {
  const invalid = (events: CoreEvent[], eventId: number, reason: string) =>
    expect(validateEventSequence(players, events)).toEqual({
      ok: false,
      error: { code: 'INVALID_EVENT_SEQUENCE', eventId, reason },
    });

  it('accepts a valid sequence', () => {
    expect(
      validateEventSequence(
        players,
        log(['a', 'buy_in', 1], ['a', 'cash_out', 0], ['a', 'buy_in', 1]),
      ),
    ).toEqual({ ok: true, value: undefined });
  });

  it('rejects a rebuy without a buy-in', () => {
    invalid(log(['a', 'rebuy', 10]), 1, 'NOT_SEATED');
  });

  it('rejects a cash-out of a player who is not seated', () => {
    invalid(log(['a', 'buy_in', 10], ['a', 'cash_out', 5], ['a', 'cash_out', 5]), 3, 'NOT_SEATED');
  });

  it('rejects a buy-in of a seated player', () => {
    invalid(log(['a', 'buy_in', 10], ['a', 'buy_in', 10]), 2, 'ALREADY_SEATED');
  });

  it('rejects non-positive purchases and negative cash-outs', () => {
    invalid(log(['a', 'buy_in', 0]), 1, 'INVALID_CHIPS');
    invalid(log(['a', 'buy_in', 10], ['a', 'rebuy', -1]), 2, 'INVALID_CHIPS');
    invalid(log(['a', 'buy_in', 10], ['a', 'cash_out', -1]), 2, 'INVALID_CHIPS');
    invalid(log(['a', 'buy_in', 1.5]), 1, 'INVALID_CHIPS');
    invalid(
      [{ id: 1, playerId: 'a', type: 'buy_in', chips: null, cancelled: false }],
      1,
      'INVALID_CHIPS',
    );
  });

  it('rejects chip events of unknown players or without a player', () => {
    invalid(log(['x', 'buy_in', 10]), 1, 'UNKNOWN_PLAYER');
    invalid(
      [{ id: 7, playerId: null, type: 'buy_in', chips: 10, cancelled: false }],
      7,
      'UNKNOWN_PLAYER',
    );
  });

  it('rejects totals beyond the safe integer range', () => {
    const big = Number.MAX_SAFE_INTEGER;
    expect(() =>
      validateEventSequence(players, log(['a', 'buy_in', big], ['a', 'rebuy', big])),
    ).toThrow(CoreError);
  });
});

describe('validateNewEvent', () => {
  it('checks the event appended after the existing ones', () => {
    const events = log(['a', 'buy_in', 10]);
    expect(validateNewEvent(players, events, { playerId: 'a', type: 'rebuy', chips: 5 }).ok).toBe(
      true,
    );
    expect(validateNewEvent(players, events, { playerId: 'a', type: 'buy_in', chips: 5 })).toEqual({
      ok: false,
      error: { code: 'INVALID_EVENT_SEQUENCE', eventId: 2, reason: 'ALREADY_SEATED' },
    });
    expect(validateNewEvent(players, [], { playerId: 'b', type: 'buy_in', chips: 5 }).ok).toBe(
      true,
    );
  });
});

describe('inferBuyType', () => {
  const events = log(['a', 'buy_in', 10], ['b', 'buy_in', 10], ['b', 'cash_out', 10]);

  it('is a rebuy for a seated player and a buy-in otherwise', () => {
    expect(inferBuyType(players, events, 'a')).toBe('rebuy');
    expect(inferBuyType(players, events, 'b')).toBe('buy_in');
    expect(inferBuyType(players, events, 'c')).toBe('buy_in');
  });

  it('throws for a player outside the game', () => {
    expect(() => inferBuyType(players, events, 'x')).toThrow(CoreError);
  });
});

describe('canCancelEvent', () => {
  it('forbids cancelling a buy-in followed by a cash-out and names the cash-out', () => {
    const events = log(['a', 'buy_in', 10], ['b', 'buy_in', 10], ['a', 'cash_out', 5]);
    expect(canCancelEvent(players, events, 1)).toEqual({
      ok: false,
      error: { code: 'INVALID_EVENT_SEQUENCE', blockingEventId: 3 },
    });
    expect(canCancelEvent(players, events, 3)).toEqual({ ok: true, value: undefined });
  });

  it('forbids cancelling a cash-out followed by a re-entry', () => {
    const events = log(['a', 'buy_in', 10], ['a', 'cash_out', 5], ['a', 'buy_in', 10]);
    expect(canCancelEvent(players, events, 2)).toEqual({
      ok: false,
      error: { code: 'INVALID_EVENT_SEQUENCE', blockingEventId: 3 },
    });
  });

  it('walks a chain: rebuy first, then cash-out, then the buy-in', () => {
    let events = log(['a', 'buy_in', 10], ['a', 'rebuy', 10], ['a', 'cash_out', 5]);
    expect(canCancelEvent(players, events, 1)).toMatchObject({ error: { blockingEventId: 2 } });
    events = events.map((e) => (e.id === 3 ? { ...e, cancelled: true } : e));
    expect(canCancelEvent(players, events, 1)).toMatchObject({ error: { blockingEventId: 2 } });
    events = events.map((e) => (e.id === 2 ? { ...e, cancelled: true } : e));
    expect(canCancelEvent(players, events, 1).ok).toBe(true);
  });

  it('allows cancelling a rebuy', () => {
    const events = log(['a', 'buy_in', 10], ['a', 'rebuy', 10], ['a', 'cash_out', 5]);
    expect(canCancelEvent(players, events, 2).ok).toBe(true);
  });

  it('reports missing, already cancelled and non-chip events', () => {
    const events: CoreEvent[] = [
      { id: 1, playerId: null, type: 'game_created', chips: null, cancelled: false },
      { id: 2, playerId: 'a', type: 'buy_in', chips: 10, cancelled: true },
    ];
    expect(canCancelEvent(players, events, 9)).toEqual({
      ok: false,
      error: { code: 'EVENT_NOT_FOUND' },
    });
    expect(canCancelEvent(players, events, 2)).toEqual({
      ok: false,
      error: { code: 'EVENT_ALREADY_CANCELLED' },
    });
    expect(canCancelEvent(players, events, 1)).toEqual({
      ok: false,
      error: { code: 'EVENT_NOT_CANCELLABLE' },
    });
  });
});
