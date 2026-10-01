import { describe, expect, it } from 'vitest';

import { listGameEvents } from '../db/repositories/gameEvents';
import { listGameResults } from '../db/repositories/gameResults';
import { findGame } from '../db/repositories/games';
import { listSettlement } from '../db/repositories/settlements';
import { recordBuy } from './events';
import { finishGame, previewFinish } from './finish';
import { createGame } from './games';
import { deleteGame, reopenGame } from './lifecycle';
import { getGameState } from './state';
import {
  ALICE,
  BOB,
  CAROL,
  addGuests,
  createTestDeps,
  currentVersion,
  playExample85,
  setupGame,
} from './testing';

const proportional = { mode: 'proportional' } as const;

describe('finish', () => {
  it('SPEC §8.5: no mismatch, results and minimal transfers are stored', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const p = await playExample85(deps, game.id);
    const finalChips = { [p.petya]: 71_000, [p.kolya]: 52_000, [p.dima]: 30_000 };

    const preview = await previewFinish(deps, CAROL, game.id, {
      finalChips,
      mismatch: proportional,
    });
    expect(preview.mismatchChips).toBe(0);
    expect(findGame(deps.db, game.id)?.status).toBe('active');

    const version = currentVersion(deps, game.id);
    const result = await finishGame(deps, CAROL, game.id, {
      finalChips,
      mismatch: proportional,
      expectedVersion: version,
    });
    expect(result).toEqual(preview);
    expect(result.players.map((r) => r.moneyResult)).toEqual([-1600, 1367, 233, 0]);
    expect(result.transfers).toEqual([
      { from: p.vasya, to: p.petya, amount: 1367 },
      { from: p.vasya, to: p.kolya, amount: 233 },
    ]);

    expect(findGame(deps.db, game.id)).toMatchObject({
      status: 'finished',
      mismatchMode: 'proportional',
      mismatchChips: 0,
      settlementIsManual: false,
      version: version + 1,
    });
    expect(listGameResults(deps.db, game.id)).toHaveLength(4);
    expect(listSettlement(deps.db, game.id)).toHaveLength(2);
    const events = listGameEvents(deps.db, game.id);
    expect(events.filter((e) => e.payload?.source === 'finish').map((e) => e.chips)).toEqual([
      71_000, 52_000, 30_000,
    ]);
    expect(events.at(-1)?.type).toBe('game_finished');

    const state = await getGameState(deps, BOB, game.id);
    expect(state.players.every((pl) => pl.status === 'left')).toBe(true);
    expect(state.players.map((pl) => pl.moneyResult)).toEqual([-1600, 1367, 233, 0]);
  });

  it('SPEC §8.6: mismatch distributed proportionally', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const p = await playExample85(deps, game.id);
    const result = await finishGame(deps, BOB, game.id, {
      finalChips: { [p.petya]: 71_000, [p.kolya]: 52_000, [p.dima]: 29_000 },
      mismatch: proportional,
      expectedVersion: currentVersion(deps, game.id),
    });
    expect(result.mismatchChips).toBe(-1000);
    expect(result.players.map((r) => r.moneyResult)).toEqual([-1588, 1373, 242, -27]);
    expect(result.transfers).toEqual([
      { from: p.vasya, to: p.petya, amount: 1373 },
      { from: p.vasya, to: p.kolya, amount: 215 },
      { from: p.dima, to: p.kolya, amount: 27 },
    ]);
    expect(listGameResults(deps.db, game.id).find((r) => r.playerId === p.vasya)).toMatchObject({
      adjustmentChipsNum: 4000,
      adjustmentChipsDen: 11,
    });
    expect(findGame(deps.db, game.id)?.mismatchChips).toBe(-1000);
  });

  it('mismatch on a single player', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const p = await playExample85(deps, game.id);
    const result = await finishGame(deps, BOB, game.id, {
      finalChips: { [p.petya]: 71_000, [p.kolya]: 52_000, [p.dima]: 29_000 },
      mismatch: { mode: 'single_player', playerId: p.dima },
      expectedVersion: currentVersion(deps, game.id),
    });
    expect(result.players.map((r) => r.moneyResult)).toEqual([-1600, 1367, 233, 0]);
    expect(findGame(deps.db, game.id)).toMatchObject({
      mismatchMode: 'single_player',
      mismatchPlayerId: p.dima,
    });
  });

  it('requires chips of every seated player (V1-FIN-05) and a valid mismatch player', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const p = await playExample85(deps, game.id);
    const version = currentVersion(deps, game.id);
    await expect(
      finishGame(deps, BOB, game.id, {
        finalChips: { [p.petya]: 71_000 },
        mismatch: proportional,
        expectedVersion: version,
      }),
    ).rejects.toMatchObject({
      code: 'MISSING_FINAL_CHIPS',
      details: { playerIds: [p.kolya, p.dima] },
    });
    await expect(
      finishGame(deps, BOB, game.id, {
        finalChips: { [p.petya]: 1, [p.kolya]: 1, [p.dima]: 1, [p.vasya]: 5 },
        mismatch: proportional,
        expectedVersion: version,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_FINAL_CHIPS', details: { playerIds: [p.vasya] } });
    await expect(
      previewFinish(deps, BOB, game.id, {
        finalChips: { [p.petya]: 1, [p.kolya]: 1, [p.dima]: 1 },
        mismatch: { mode: 'single_player', playerId: 'nobody' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MISMATCH_PLAYER' });
    expect(currentVersion(deps, game.id)).toBe(version);
    expect(listGameEvents(deps.db, game.id).some((e) => e.payload?.source === 'finish')).toBe(
      false,
    );
  });

  it('an empty game can only be deleted (V1-FIN-08)', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    await addGuests(deps, game.id, ['Вася']);
    await expect(
      finishGame(deps, BOB, game.id, {
        finalChips: {},
        mismatch: proportional,
        expectedVersion: currentVersion(deps, game.id),
      }),
    ).rejects.toMatchObject({ code: 'EMPTY_GAME' });
    await deleteGame(deps, BOB, game.id);
    expect(findGame(deps.db, game.id)?.status).toBe('deleted');
  });

  it('rejects a stale expectedVersion with CONFLICT', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const [vasya] = (await addGuests(deps, game.id, ['Вася'])) as [string];
    await recordBuy(deps, BOB, game.id, { playerId: vasya, chips: 100 });
    const stale = currentVersion(deps, game.id);
    await recordBuy(deps, BOB, game.id, { playerId: vasya, chips: 100 });
    await expect(
      finishGame(deps, BOB, game.id, {
        finalChips: { [vasya]: 200 },
        mismatch: proportional,
        expectedVersion: stale,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { version: stale + 1 } });
  });
});

describe('reopen and delete', () => {
  async function finishedExample(deps: ReturnType<typeof createTestDeps>) {
    const { chat, game } = await setupGame(deps);
    const p = await playExample85(deps, game.id);
    await finishGame(deps, BOB, game.id, {
      finalChips: { [p.petya]: 71_000, [p.kolya]: 52_000, [p.dima]: 30_000 },
      mismatch: proportional,
      expectedVersion: currentVersion(deps, game.id),
    });
    return { chat, game, p };
  }

  it('reopen seats players again with their chips; finishing again works (V1-EDIT-02)', async () => {
    const deps = createTestDeps();
    const { game, p } = await finishedExample(deps);
    await reopenGame(deps, BOB, game.id);

    expect(findGame(deps.db, game.id)).toMatchObject({
      status: 'active',
      finishedAt: null,
      mismatchMode: null,
      mismatchChips: null,
    });
    expect(listGameResults(deps.db, game.id)).toEqual([]);
    expect(listSettlement(deps.db, game.id)).toEqual([]);
    const state = await getGameState(deps, BOB, game.id);
    expect(state.players.map((pl) => pl.status)).toEqual(['left', 'seated', 'seated', 'seated']);
    expect(listGameEvents(deps.db, game.id).at(-1)?.type).toBe('game_reopened');

    await recordBuy(deps, BOB, game.id, { playerId: p.dima, chips: 30_000 });
    const again = await finishGame(deps, BOB, game.id, {
      finalChips: { [p.petya]: 71_000, [p.kolya]: 52_000, [p.dima]: 60_000 },
      mismatch: proportional,
      expectedVersion: currentVersion(deps, game.id),
    });
    expect(again.players.map((r) => r.moneyResult)).toEqual([-1600, 1367, 233, 0]);
  });

  it('only the creator or an admin may reopen or delete; not with another active game', async () => {
    const deps = createTestDeps();
    const { chat, game } = await finishedExample(deps);
    await expect(reopenGame(deps, CAROL, game.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(deleteGame(deps, CAROL, game.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const other = await createGame(deps, CAROL, chat.id);
    await expect(reopenGame(deps, ALICE, game.id)).rejects.toMatchObject({
      code: 'ACTIVE_GAME_EXISTS',
      details: { gameId: other.id },
    });
    await deleteGame(deps, ALICE, other.id);
    await reopenGame(deps, ALICE, game.id);
    expect(findGame(deps.db, game.id)?.status).toBe('active');
  });

  it('a deleted game is not found any more (V1-EDIT-03)', async () => {
    const deps = createTestDeps();
    const { game } = await finishedExample(deps);
    await deleteGame(deps, BOB, game.id);
    expect(findGame(deps.db, game.id)).toMatchObject({ status: 'deleted' });
    expect(listGameEvents(deps.db, game.id).at(-1)).toMatchObject({
      type: 'game_deleted',
      payload: { previousStatus: 'finished' },
    });
    await expect(getGameState(deps, BOB, game.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
