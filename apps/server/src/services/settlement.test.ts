import { describe, expect, it } from 'vitest';

import { findGame } from '../db/repositories/games';
import { listGameEvents } from '../db/repositories/gameEvents';
import { buySelf } from './events';
import { finishGame } from './finish';
import { addPlayerToGame } from './games';
import { getGameDetails } from './history';
import { updateProfile } from './profile';
import { getSettlement, resetSettlement, saveSettlement } from './settlement';
import { getGameLog, getGameState } from './state';
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  MALLORY,
  TG_CHAT_ID,
  createTestDeps,
  currentVersion,
  setupGame,
} from './testing';

/** Carol wins 1 000 from Dave; Bob created the game but did not play. */
async function finishedGame(deps: ReturnType<typeof createTestDeps>) {
  const { game } = await setupGame(deps);
  const carol = await buySelf(deps, CAROL, game.id, { expect: 'buy_in' });
  const dave = await buySelf(deps, DAVE, game.id, { expect: 'buy_in' });
  await finishGame(deps, BOB, game.id, {
    finalChips: { [carol.playerId]: 60_000, [dave.playerId]: 0 },
    mismatch: { mode: 'proportional' },
    expectedVersion: currentVersion(deps, game.id),
  });
  updateProfile(deps, CAROL, { payPhone: '+79991112233', payBank: 'Сбер' });
  return { game, carol: carol.playerId, dave: dave.playerId };
}

describe('settlement', () => {
  it('payment details are returned only to players of the game', async () => {
    const deps = createTestDeps();
    const { game, carol, dave } = await finishedGame(deps);

    const forPlayer = await getSettlement(deps, DAVE, game.id);
    expect(forPlayer.transfers).toEqual([
      {
        from: dave,
        to: carol,
        amount: 1000,
        recipientPayment: { phone: '+79991112233', bank: 'Сбер', note: null },
      },
    ]);
    const forCreator = await getSettlement(deps, BOB, game.id);
    expect(forCreator.transfers).toEqual([{ from: dave, to: carol, amount: 1000 }]);
    await expect(getSettlement(deps, MALLORY, game.id)).rejects.toMatchObject({
      code: 'NOT_CHAT_MEMBER',
    });

    // Nowhere else: state, log and details carry no payment details.
    const everything = JSON.stringify([
      await getGameState(deps, DAVE, game.id),
      await getGameLog(deps, DAVE, game.id),
      await getGameDetails(deps, DAVE, game.id),
    ]);
    expect(everything).not.toContain('79991112233');
    expect(everything).not.toContain('Сбер');
  });

  it('a player who left the chat can still view the finished game', async () => {
    const deps = createTestDeps();
    const { game } = await finishedGame(deps);
    deps.setMembership(TG_CHAT_ID, DAVE.tgUserId, 'none');
    expect((await getGameState(deps, DAVE, game.id)).status).toBe('finished');
    expect((await getSettlement(deps, DAVE, game.id)).transfers[0]?.recipientPayment).toBeDefined();
    // ...but cannot edit it.
    await expect(
      saveSettlement(deps, DAVE, game.id, {
        transfers: [],
        expectedVersion: currentVersion(deps, game.id),
      }),
    ).rejects.toMatchObject({ code: 'NOT_CHAT_MEMBER' });
  });

  it('manual settlement saves with warnings, is logged and can be reset', async () => {
    const deps = createTestDeps();
    const { game, carol, dave } = await finishedGame(deps);
    deps.scheduled.length = 0;
    const version = currentVersion(deps, game.id);

    const saved = await saveSettlement(deps, DAVE, game.id, {
      transfers: [{ from: dave, to: carol, amount: 900 }],
      expectedVersion: version,
    });
    expect(saved).toMatchObject({ isManual: true, version: version + 1 });
    expect(saved.warnings).toEqual([
      { code: 'BALANCE_MISMATCH', playerId: carol, delta: -100 },
      { code: 'BALANCE_MISMATCH', playerId: dave, delta: 100 },
    ]);
    expect(findGame(deps.db, game.id)?.settlementIsManual).toBe(true);
    expect(listGameEvents(deps.db, game.id).at(-1)?.type).toBe('settlement_edited');
    expect(deps.scheduled).toEqual([game.id]);

    await expect(
      saveSettlement(deps, DAVE, game.id, { transfers: [], expectedVersion: version }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const reset = await resetSettlement(deps, CAROL, game.id);
    expect(reset).toMatchObject({ isManual: false, warnings: [] });
    expect(reset.transfers).toEqual([{ from: dave, to: carol, amount: 1000 }]);
  });

  it('rejects non-positive amounts, self-transfers and unknown players', async () => {
    const deps = createTestDeps();
    const { game, carol, dave } = await finishedGame(deps);
    const expectedVersion = currentVersion(deps, game.id);
    await expect(
      saveSettlement(deps, CAROL, game.id, {
        transfers: [
          { from: dave, to: carol, amount: 0 },
          { from: carol, to: carol, amount: 5 },
        ],
        expectedVersion,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      details: {
        transfers: [
          { index: 0, code: 'NON_POSITIVE_AMOUNT' },
          { index: 1, code: 'SELF_TRANSFER' },
        ],
      },
    });
    await expect(
      saveSettlement(deps, CAROL, game.id, {
        transfers: [{ from: dave, to: 'stranger', amount: 5 }],
        expectedVersion,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { reason: 'UNKNOWN_PLAYER' } });
  });

  it('only players, the creator and admins may edit the settlement', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const carol = await buySelf(deps, CAROL, game.id, { expect: 'buy_in' });
    await addPlayerToGame(deps, BOB, game.id, { guestName: 'Гость' });
    await finishGame(deps, BOB, game.id, {
      finalChips: { [carol.playerId]: 30_000 },
      mismatch: { mode: 'proportional' },
      expectedVersion: currentVersion(deps, game.id),
    });
    const outsider = { tgUserId: 5, firstName: 'Eve' };
    deps.setMembership(TG_CHAT_ID, outsider.tgUserId, 'member');
    await expect(
      saveSettlement(deps, outsider, game.id, {
        transfers: [],
        expectedVersion: currentVersion(deps, game.id),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const who of [CAROL, BOB, ALICE]) {
      await saveSettlement(deps, who, game.id, {
        transfers: [],
        expectedVersion: currentVersion(deps, game.id),
      });
    }
  });

  it('is available only for finished games', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    await expect(getSettlement(deps, BOB, game.id)).rejects.toMatchObject({
      code: 'INVALID_GAME_STATUS',
    });
  });
});
