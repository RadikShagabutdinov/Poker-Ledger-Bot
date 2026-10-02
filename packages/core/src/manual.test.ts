import { describe, expect, it } from 'vitest';

import { checkManualSettlement, validateTransfers } from './manual';

const results = [
  { playerId: 'vasya', money: -1600 },
  { playerId: 'petya', money: 1367 },
  { playerId: 'kolya', money: 233 },
];

describe('checkManualSettlement', () => {
  it('has no warnings for a matching settlement', () => {
    expect(
      checkManualSettlement(
        [
          { from: 'vasya', to: 'petya', amount: 1367 },
          { from: 'vasya', to: 'kolya', amount: 233 },
        ],
        results,
      ),
    ).toEqual([]);
  });

  it('reports per-player deltas', () => {
    expect(
      checkManualSettlement(
        [
          { from: 'vasya', to: 'petya', amount: 1400 },
          { from: 'vasya', to: 'kolya', amount: 233 },
        ],
        results,
      ),
    ).toEqual([
      { code: 'BALANCE_MISMATCH', playerId: 'vasya', delta: -33 },
      { code: 'BALANCE_MISMATCH', playerId: 'petya', delta: 33 },
    ]);
  });

  it('reports every result when the settlement is empty', () => {
    expect(checkManualSettlement([], results)).toHaveLength(3);
  });

  it('warns about players outside the game once each', () => {
    expect(
      checkManualSettlement(
        [
          { from: 'vasya', to: 'petya', amount: 1367 },
          { from: 'vasya', to: 'kolya', amount: 233 },
          { from: 'stranger', to: 'kolya', amount: 1 },
          { from: 'kolya', to: 'stranger', amount: 1 },
        ],
        results,
      ),
    ).toEqual([{ code: 'UNKNOWN_PLAYER', playerId: 'stranger' }]);
  });
});

describe('validateTransfers', () => {
  it('accepts valid transfers', () => {
    expect(validateTransfers([{ from: 'a', to: 'b', amount: 1 }])).toEqual([]);
  });

  it('rejects non-positive and non-integer amounts and self-transfers', () => {
    expect(
      validateTransfers([
        { from: 'a', to: 'b', amount: 0 },
        { from: 'a', to: 'b', amount: -5 },
        { from: 'a', to: 'b', amount: 1.5 },
        { from: 'a', to: 'a', amount: 10 },
        { from: 'a', to: 'a', amount: 0 },
      ]),
    ).toEqual([
      { index: 0, code: 'NON_POSITIVE_AMOUNT' },
      { index: 1, code: 'NON_POSITIVE_AMOUNT' },
      { index: 2, code: 'INVALID_AMOUNT' },
      { index: 3, code: 'SELF_TRANSFER' },
      { index: 4, code: 'NON_POSITIVE_AMOUNT' },
      { index: 4, code: 'SELF_TRANSFER' },
    ]);
  });
});
