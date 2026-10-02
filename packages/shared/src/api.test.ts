import { describe, expect, it } from 'vitest';

import {
  addGamePlayerBodySchema,
  finishBodySchema,
  gameEventBodySchema,
  historyQuerySchema,
  settlementPutBodySchema,
} from './index';

describe('API request schemas', () => {
  it('history query: coerces numbers from the query string', () => {
    expect(historyQuerySchema.parse({ from: '1000', status: 'finished' })).toEqual({
      from: 1000,
      status: 'finished',
    });
    expect(historyQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });

  it('add player: exactly one of playerId, guestName, self', () => {
    expect(addGamePlayerBodySchema.safeParse({ playerId: 'p1' }).success).toBe(true);
    expect(addGamePlayerBodySchema.safeParse({ guestName: 'Вася' }).success).toBe(true);
    expect(addGamePlayerBodySchema.safeParse({ self: true }).success).toBe(true);
    expect(addGamePlayerBodySchema.safeParse({ self: false }).success).toBe(false);
    expect(addGamePlayerBodySchema.safeParse({ playerId: 'p1', self: true }).success).toBe(false);
  });

  it('events: only buy and cash_out', () => {
    expect(gameEventBodySchema.safeParse({ type: 'buy', playerId: 'p', chips: 1 }).success).toBe(
      true,
    );
    expect(gameEventBodySchema.safeParse({ type: 'rebuy', playerId: 'p', chips: 1 }).success).toBe(
      false,
    );
  });

  it('finish and settlement save require expectedVersion', () => {
    const finish = { finalChips: { p: 10 }, mismatchMode: 'proportional' };
    expect(finishBodySchema.safeParse(finish).success).toBe(false);
    expect(finishBodySchema.safeParse({ ...finish, expectedVersion: 3 }).success).toBe(true);
    expect(settlementPutBodySchema.safeParse({ transfers: [] }).success).toBe(false);
  });
});
