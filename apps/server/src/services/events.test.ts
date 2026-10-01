import { describe, expect, it } from 'vitest';

import { listGameEvents } from '../db/repositories/gameEvents';
import {
  UNDO_MINE_WINDOW_MS,
  buySelf,
  cancelEvent,
  recordBuy,
  recordCashOut,
  undoLast,
} from './events';
import { getGameLog, getGameState } from './state';
import {
  ALICE,
  BOB,
  CAROL,
  MALLORY,
  addGuests,
  createTestDeps,
  currentVersion,
  setupGame,
} from './testing';

describe('chip events', () => {
  it('buy-in → rebuy → cash-out → buy-in again (V1-PLAY-01..05)', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const [vasya] = (await addGuests(deps, game.id, ['Вася'])) as [string];

    expect(await recordBuy(deps, BOB, game.id, { playerId: vasya, chips: 30_000 })).toMatchObject({
      type: 'buy_in',
    });
    expect(await recordBuy(deps, BOB, game.id, { playerId: vasya, chips: 15_000 })).toMatchObject({
      type: 'rebuy',
    });
    let state = await getGameState(deps, BOB, game.id);
    expect(state.players[0]).toMatchObject({
      status: 'seated',
      inChips: 45_000,
      moneyResult: null,
    });

    await recordCashOut(deps, BOB, game.id, { playerId: vasya, chips: 50_000 });
    state = await getGameState(deps, BOB, game.id);
    // Provisional result for a player who left: +5 000 chips ≈ +166.67 → 167.
    expect(state.players[0]).toMatchObject({ status: 'left', outChips: 50_000, moneyResult: 167 });

    expect(await recordBuy(deps, BOB, game.id, { playerId: vasya, chips: 12_345 })).toMatchObject({
      type: 'buy_in',
    });
    state = await getGameState(deps, BOB, game.id);
    expect(state.players[0]).toMatchObject({
      status: 'seated',
      inChips: 57_345,
      outChips: 50_000,
      buyinCount: 2,
      rebuyCount: 1,
    });
    expect(state.summary).toEqual({
      issuedChips: 57_345,
      cashedOutChips: 50_000,
      expectedOnTableChips: 7_345,
      seatedCount: 1,
    });
  });

  it('rejects invalid chips and a cash-out of a player who is not seated', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const [vasya] = (await addGuests(deps, game.id, ['Вася'])) as [string];
    await expect(
      recordBuy(deps, BOB, game.id, { playerId: vasya, chips: 0 }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      recordCashOut(deps, BOB, game.id, { playerId: vasya, chips: 0 }),
    ).rejects.toMatchObject({ code: 'INVALID_EVENT_SEQUENCE', details: { reason: 'NOT_SEATED' } });
    await expect(
      recordBuy(deps, BOB, game.id, { playerId: 'nobody', chips: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('every mutation bumps the version and schedules a message update after commit', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const [vasya] = (await addGuests(deps, game.id, ['Вася'])) as [string];
    const v = currentVersion(deps, game.id);
    await recordBuy(deps, BOB, game.id, { playerId: vasya, chips: 100 });
    expect(currentVersion(deps, game.id)).toBe(v + 1);
    expect(deps.scheduled).toEqual([game.id, game.id]);

    // A rejected mutation writes nothing and schedules nothing.
    await expect(
      recordCashOut(deps, BOB, game.id, { playerId: vasya, chips: -1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      recordBuy(deps, MALLORY, game.id, { playerId: vasya, chips: 1 }),
    ).rejects.toMatchObject({
      code: 'NOT_CHAT_MEMBER',
    });
    expect(currentVersion(deps, game.id)).toBe(v + 1);
    expect(deps.scheduled).toHaveLength(2);
  });
});

describe('chat buttons (buySelf)', () => {
  it('«I am in» seats the user with one stack; repeated press says already seated', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    expect(await buySelf(deps, CAROL, game.id, { expect: 'buy_in' })).toMatchObject({
      type: 'buy_in',
      chips: 30_000,
    });
    await expect(buySelf(deps, CAROL, game.id, { expect: 'buy_in' })).rejects.toMatchObject({
      code: 'INVALID_EVENT_SEQUENCE',
      details: { reason: 'ALREADY_SEATED' },
    });
    expect(await buySelf(deps, CAROL, game.id, { expect: 'rebuy' })).toMatchObject({
      type: 'rebuy',
    });
  });

  it('«Rebuy» for a user who is not seated writes nothing', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const version = currentVersion(deps, game.id);
    await expect(buySelf(deps, CAROL, game.id, { expect: 'rebuy' })).rejects.toMatchObject({
      code: 'INVALID_EVENT_SEQUENCE',
      details: { reason: 'NOT_SEATED' },
    });
    expect((await getGameState(deps, BOB, game.id)).players).toEqual([]);
    expect(currentVersion(deps, game.id)).toBe(version);
  });
});

describe('cancel and undo', () => {
  it('rejects a cancel that breaks the sequence and names the blocking event (V1-LOG-04)', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const [vasya] = (await addGuests(deps, game.id, ['Вася'])) as [string];
    const buyIn = await recordBuy(deps, BOB, game.id, { playerId: vasya, chips: 30_000 });
    const cashOut = await recordCashOut(deps, BOB, game.id, { playerId: vasya, chips: 10_000 });

    await expect(cancelEvent(deps, BOB, game.id, buyIn.eventId)).rejects.toMatchObject({
      code: 'INVALID_EVENT_SEQUENCE',
      details: { blockingEventId: cashOut.eventId },
    });
    await cancelEvent(deps, BOB, game.id, cashOut.eventId);
    await cancelEvent(deps, BOB, game.id, buyIn.eventId);
    await expect(cancelEvent(deps, BOB, game.id, buyIn.eventId)).rejects.toMatchObject({
      code: 'EVENT_NOT_CANCELLABLE',
    });

    const log = await getGameLog(deps, BOB, game.id);
    expect(log.filter((e) => e.cancelled).map((e) => e.id)).toEqual([
      buyIn.eventId,
      cashOut.eventId,
    ]);
    expect((await getGameState(deps, BOB, game.id)).players[0]).toMatchObject({
      status: 'not_joined',
      inChips: 0,
    });
  });

  it('game-level events are not cancellable', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const created = listGameEvents(deps.db, game.id)[0]!;
    await expect(cancelEvent(deps, BOB, game.id, created.id)).rejects.toMatchObject({
      code: 'EVENT_NOT_CANCELLABLE',
    });
  });

  it('undo cancels the last chip event of anyone', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    await buySelf(deps, CAROL, game.id, { expect: 'buy_in' });
    const last = await buySelf(deps, ALICE, game.id, { expect: 'buy_in' });
    expect(await undoLast(deps, BOB, game.id)).toMatchObject({ eventId: last.eventId });
  });

  it('«Undo mine» cancels only the own last event and only within 15 minutes (V1-MSG-03)', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const mine = await buySelf(deps, CAROL, game.id, { expect: 'buy_in' });
    await buySelf(deps, ALICE, game.id, { expect: 'buy_in' });

    await expect(undoLast(deps, BOB, game.id, { mineOnly: true })).rejects.toMatchObject({
      code: 'NOTHING_TO_UNDO',
    });
    deps.advance(UNDO_MINE_WINDOW_MS + 1);
    await expect(undoLast(deps, CAROL, game.id, { mineOnly: true })).rejects.toMatchObject({
      code: 'NOTHING_TO_UNDO',
    });

    const fresh = createTestDeps();
    const { game: g2 } = await setupGame(fresh);
    const own = await buySelf(fresh, CAROL, g2.id, { expect: 'buy_in' });
    await buySelf(fresh, ALICE, g2.id, { expect: 'buy_in' });
    fresh.advance(UNDO_MINE_WINDOW_MS);
    expect(await undoLast(fresh, CAROL, g2.id, { mineOnly: true })).toMatchObject({
      eventId: own.eventId,
    });
    expect(mine.type).toBe('buy_in');
  });
});
