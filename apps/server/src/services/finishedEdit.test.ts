import { describe, expect, it } from 'vitest';

import { listGameEvents } from '../db/repositories/gameEvents';
import { listGameResults } from '../db/repositories/gameResults';
import { findGame } from '../db/repositories/games';
import { listSettlement } from '../db/repositories/settlements';
import { cancelEvent, recordBuy } from './events';
import { finishGame } from './finish';
import {
  cancelGameEvent,
  editFinishedEvents,
  recordGameEvent,
  updateFinishedMismatch,
} from './finishedEdit';
import { updateGame } from './games';
import { reopenGame } from './lifecycle';
import { saveSettlement } from './settlement';
import { getGameState } from './state';
import {
  ALICE,
  BOB,
  CAROL,
  createTestDeps,
  currentVersion,
  playExample85,
  setupGame,
} from './testing';

async function finished85(deps: ReturnType<typeof createTestDeps>, dimaChips = 30_000) {
  const { game } = await setupGame(deps);
  const p = await playExample85(deps, game.id);
  await finishGame(deps, BOB, game.id, {
    finalChips: { [p.petya]: 71_000, [p.kolya]: 52_000, [p.dima]: dimaChips },
    mismatch: { mode: 'proportional' },
    expectedVersion: currentVersion(deps, game.id),
  });
  return { game, p };
}

function money(deps: ReturnType<typeof createTestDeps>, gameId: string, ids: string[]) {
  const results = new Map(listGameResults(deps.db, gameId).map((r) => [r.playerId, r.moneyResult]));
  return ids.map((id) => results.get(id));
}

function eventOf(
  deps: ReturnType<typeof createTestDeps>,
  gameId: string,
  playerId: string,
  type: string,
) {
  return listGameEvents(deps.db, gameId).find(
    (e) => e.playerId === playerId && e.type === type && e.cancelledAt === null,
  )!;
}

describe('editing a finished game', () => {
  it('replaces a chip amount in place and recalculates results (V1-EDIT-01, V1-RES-03)', async () => {
    const deps = createTestDeps();
    const { game, p } = await finished85(deps, 29_000);
    const ids = [p.vasya, p.petya, p.kolya, p.dima];
    expect(money(deps, game.id, ids)).toEqual([-1588, 1373, 242, -27]);

    // Vasya's rebuy was actually 15 000, not 30 000: an event in the middle of his sequence.
    const rebuy = eventOf(deps, game.id, p.vasya, 'rebuy');
    await editFinishedEvents(deps, BOB, game.id, {
      replace: [{ eventId: rebuy.id, chips: 15_000 }],
    });
    // IN = 150 000, OUT = 164 000.
    expect(findGame(deps.db, game.id)?.mismatchChips).toBe(14_000);
    expect(money(deps, game.id, ids).reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBe(0);
    const replacement = listGameEvents(deps.db, game.id).at(-1);
    expect(replacement).toMatchObject({
      type: 'rebuy',
      chips: 15_000,
      payload: { replaces: rebuy.id },
    });
    expect(listSettlement(deps.db, game.id).length).toBeGreaterThan(0);

    // The same edit through the stack: SPEC §8.6 again after fixing Dima's count.
    const dimaOut = eventOf(deps, game.id, p.dima, 'cash_out');
    const rebuy2 = eventOf(deps, game.id, p.vasya, 'rebuy');
    await editFinishedEvents(deps, ALICE, game.id, {
      replace: [
        { eventId: rebuy2.id, chips: 30_000 },
        { eventId: dimaOut.id, chips: 30_000 },
      ],
    });
    expect(money(deps, game.id, ids)).toEqual([-1600, 1367, 233, 0]);
    expect(findGame(deps.db, game.id)?.mismatchChips).toBe(0);
  });

  it('applies cancel and add atomically; nobody may stay seated', async () => {
    const deps = createTestDeps();
    const { game, p } = await finished85(deps);
    const dimaIn = eventOf(deps, game.id, p.dima, 'buy_in');
    const dimaOut = eventOf(deps, game.id, p.dima, 'cash_out');
    const version = currentVersion(deps, game.id);

    await expect(
      editFinishedEvents(deps, BOB, game.id, { cancel: [dimaOut.id] }),
    ).rejects.toMatchObject({ code: 'MISSING_FINAL_CHIPS', details: { playerIds: [p.dima] } });
    await expect(
      editFinishedEvents(deps, BOB, game.id, { cancel: [dimaIn.id] }),
    ).rejects.toMatchObject({ code: 'INVALID_EVENT_SEQUENCE', details: { eventId: dimaOut.id } });
    expect(currentVersion(deps, game.id)).toBe(version);

    // Dima did not play: drop both events; Vasya re-entered for 10 000 and left with 10 000.
    await editFinishedEvents(deps, BOB, game.id, {
      cancel: [dimaOut.id, dimaIn.id],
      add: [
        { playerId: p.vasya, type: 'buy_in', chips: 10_000 },
        { playerId: p.vasya, type: 'cash_out', chips: 10_000 },
      ],
    });
    expect(money(deps, game.id, [p.vasya, p.petya, p.kolya, p.dima])).toEqual([
      -1600, 1367, 233, 0,
    ]);
    const state = await getGameState(deps, BOB, game.id);
    expect(state.players.find((pl) => pl.playerId === p.vasya)).toMatchObject({ buyinCount: 2 });
    expect(state.players.find((pl) => pl.playerId === p.dima)).toMatchObject({
      status: 'not_joined',
    });
  });

  it('is allowed only to the creator and admins; active-game event APIs refuse finished games', async () => {
    const deps = createTestDeps();
    const { game, p } = await finished85(deps);
    const rebuy = eventOf(deps, game.id, p.vasya, 'rebuy');
    await expect(
      editFinishedEvents(deps, CAROL, game.id, { replace: [{ eventId: rebuy.id, chips: 1 }] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(cancelEvent(deps, BOB, game.id, rebuy.id)).rejects.toMatchObject({
      code: 'INVALID_GAME_STATUS',
    });
    await expect(
      recordBuy(deps, BOB, game.id, { playerId: p.vasya, chips: 1 }),
    ).rejects.toMatchObject({
      code: 'INVALID_GAME_STATUS',
    });
    await expect(updateGame(deps, CAROL, game.id, { name: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('a manual settlement requires a choice when results change (V1-SETL-07)', async () => {
    const deps = createTestDeps();
    const { game, p } = await finished85(deps);
    const manual = [{ from: p.vasya, to: p.petya, amount: 1600 }];
    await saveSettlement(deps, BOB, game.id, {
      transfers: manual,
      expectedVersion: currentVersion(deps, game.id),
    });

    // A rename does not touch results.
    await updateGame(deps, BOB, game.id, { name: 'Переименована' });
    // A stack change does.
    await expect(
      updateGame(deps, BOB, game.id, { stack: { chips: 30_000, amount: 2_000 } }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'SETTLEMENT_POLICY_REQUIRED' },
    });

    await updateGame(deps, BOB, game.id, {
      stack: { chips: 30_000, amount: 2_000 },
      settlementPolicy: 'keep',
    });
    expect(money(deps, game.id, [p.vasya, p.petya, p.kolya, p.dima])).toEqual([
      -3200, 2733, 467, 0,
    ]);
    expect(findGame(deps.db, game.id)?.settlementIsManual).toBe(true);
    expect(listSettlement(deps.db, game.id).map((s) => s.amount)).toEqual([1600]);

    await updateFinishedMismatch(deps, BOB, game.id, {
      mismatch: { mode: 'single_player', playerId: p.dima },
    });
    await updateGame(deps, BOB, game.id, {
      stack: { chips: 30_000, amount: 1_000 },
      settlementPolicy: 'recalculate',
    });
    expect(findGame(deps.db, game.id)).toMatchObject({
      settlementIsManual: false,
      mismatchMode: 'single_player',
    });
    expect(listSettlement(deps.db, game.id).map((s) => s.amount)).toEqual([1367, 233]);
  });

  it('reopen cancels the finish cash-out even after it was replaced', async () => {
    const deps = createTestDeps();
    const { game, p } = await finished85(deps, 29_000);
    const dimaOut = eventOf(deps, game.id, p.dima, 'cash_out');
    await editFinishedEvents(deps, BOB, game.id, {
      replace: [{ eventId: dimaOut.id, chips: 30_000 }],
    });
    expect(eventOf(deps, game.id, p.dima, 'cash_out').payload).toMatchObject({ source: 'finish' });
    await reopenGame(deps, BOB, game.id);
    const state = await getGameState(deps, BOB, game.id);
    expect(state.players.map((pl) => pl.status)).toEqual(['left', 'seated', 'seated', 'seated']);
  });
});

describe('events by game status (API)', () => {
  it('records and cancels events of an active game directly', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const p = await playExample85(deps, game.id);
    const event = await recordGameEvent(deps, BOB, game.id, {
      type: 'buy',
      playerId: p.dima,
      chips: 10_000,
    });
    expect(event).toMatchObject({ type: 'rebuy', chips: 10_000 });
    expect(await cancelGameEvent(deps, BOB, game.id, event?.eventId ?? 0)).toMatchObject({
      type: 'rebuy',
    });
  });

  it('turns them into edit batches of a finished game (V1-EDIT-01)', async () => {
    const deps = createTestDeps();
    const { game, p } = await finished85(deps);
    const rebuy = listGameEvents(deps.db, game.id).find(
      (e) => e.type === 'rebuy' && e.playerId === p.kolya,
    );
    // Bob created the game; Carol is a plain member.
    await expect(cancelGameEvent(deps, CAROL, game.id, rebuy?.id ?? 0)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await cancelGameEvent(deps, BOB, game.id, rebuy?.id ?? 0)).toBeNull();
    expect((await getGameState(deps, BOB, game.id)).players[2]).toMatchObject({ inChips: 30_000 });
    // A lone buy leaves the player seated without final chips.
    await expect(
      recordGameEvent(deps, BOB, game.id, { type: 'buy', playerId: p.dima, chips: 1_000 }),
    ).rejects.toMatchObject({ code: 'MISSING_FINAL_CHIPS' });
  });
});
