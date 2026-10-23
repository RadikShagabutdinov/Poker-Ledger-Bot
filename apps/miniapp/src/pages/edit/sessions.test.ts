import { describe, expect, it } from 'vitest';

import { logEntry } from '../../test/testUtils';
import { playerSessions, sessionEventIds } from './sessions';

describe('playerSessions', () => {
  it('groups buy-ins, rebuys and cash-outs and skips cancelled and other events', () => {
    const entries = [
      logEntry(1, { type: 'game_created', playerId: null, playerName: null, chips: null }),
      logEntry(2, { type: 'buy_in', chips: 30_000 }),
      logEntry(3, { type: 'buy_in', playerId: 'p2', playerName: 'Петя' }),
      logEntry(4, { type: 'rebuy', chips: 15_000 }),
      logEntry(5, { type: 'rebuy', chips: 30_000, cancelled: { by: 100, at: 1 } }),
      logEntry(6, { type: 'cash_out', chips: 50_000 }),
      logEntry(7, { type: 'buy_in', chips: 30_000 }),
      logEntry(8, { type: 'cash_out', chips: 0 }),
    ];
    const sessions = playerSessions(entries, 'p1');
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.buyIn.id).toBe(2);
    expect(sessions[0]?.rebuys.map((e) => e.id)).toEqual([4]);
    expect(sessions[0]?.cashOut?.id).toBe(6);
    expect(sessions[1]?.cashOut?.chips).toBe(0);
    expect(sessions.map(sessionEventIds)).toEqual([
      [2, 4, 6],
      [7, 8],
    ]);
  });
});
