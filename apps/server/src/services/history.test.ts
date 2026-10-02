import { describe, expect, it } from 'vitest';

import { buySelf } from './events';
import { finishGame } from './finish';
import { createGame } from './games';
import { getGameDetails, listGames } from './history';
import { deleteGame } from './lifecycle';
import {
  BOB,
  CAROL,
  MALLORY,
  START_TIME,
  createTestDeps,
  currentVersion,
  setupChat,
} from './testing';

const DAY = 24 * 60 * 60 * 1000;

async function playAndFinish(
  deps: ReturnType<typeof createTestDeps>,
  chatId: string,
  outChips: number,
) {
  const game = await createGame(deps, BOB, chatId);
  const { playerId } = await buySelf(deps, CAROL, game.id, { expect: 'buy_in' });
  await finishGame(deps, BOB, game.id, {
    finalChips: { [playerId]: outChips },
    mismatch: { mode: 'proportional' },
    expectedVersion: currentVersion(deps, game.id),
  });
  return game;
}

describe('history', () => {
  it('lists games newest first with cursor pagination, without deleted games', async () => {
    const deps = createTestDeps();
    const chat = setupChat(deps);
    const games = [];
    for (let i = 0; i < 25; i++) {
      games.push(await playAndFinish(deps, chat.id, 30_000));
      deps.advance(DAY);
    }
    await deleteGame(deps, BOB, games[24]!.id);
    const active = await createGame(deps, BOB, chat.id);

    const first = await listGames(deps, CAROL, chat.id);
    expect(first.items).toHaveLength(20);
    expect(first.items[0]).toMatchObject({ id: active.id, status: 'active', playerCount: 0 });
    expect(first.items[1]).toMatchObject({
      id: games[23]!.id,
      status: 'finished',
      playerCount: 1,
      issuedChips: 30_000,
      mismatchChips: 0,
      currency: 'RUB',
    });
    expect(first.nextCursor).not.toBeNull();

    const second = await listGames(deps, CAROL, chat.id, { cursor: first.nextCursor! });
    expect(second.items.map((g) => g.id)).toEqual(
      games
        .slice(0, 5)
        .map((g) => g.id)
        .reverse(),
    );
    expect(second.nextCursor).toBeNull();
  });

  it('filters by period and marks mismatches', async () => {
    const deps = createTestDeps();
    const chat = setupChat(deps);
    await playAndFinish(deps, chat.id, 30_000);
    deps.advance(40 * DAY);
    const later = await playAndFinish(deps, chat.id, 29_000);
    const page = await listGames(deps, BOB, chat.id, { from: START_TIME + 30 * DAY });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: later.id, mismatchChips: -1000 });
    await expect(listGames(deps, BOB, chat.id, { cursor: '!!' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(listGames(deps, MALLORY, chat.id)).rejects.toMatchObject({
      code: 'NOT_CHAT_MEMBER',
    });
  });

  it('game details include state, settlement and log', async () => {
    const deps = createTestDeps();
    const chat = setupChat(deps);
    const game = await playAndFinish(deps, chat.id, 30_000);
    const details = await getGameDetails(deps, BOB, game.id);
    expect(details.state.status).toBe('finished');
    expect(details.settlement).toMatchObject({ transfers: [], isManual: false });
    expect(details.log.map((e) => e.type)).toEqual([
      'game_created',
      'player_added',
      'buy_in',
      'cash_out',
      'game_finished',
    ]);
    expect(details.log[2]).toMatchObject({ playerName: 'Carol', createdBy: { name: 'Carol' } });
  });
});

describe('history filters', () => {
  it('filters by status and type', async () => {
    const deps = createTestDeps();
    const chat = setupChat(deps);
    const finished = await playAndFinish(deps, chat.id, 30_000);
    deps.advance(DAY);
    const active = await createGame(deps, BOB, chat.id);
    const ids = async (query: Parameters<typeof listGames>[3]) =>
      (await listGames(deps, BOB, chat.id, query)).items.map((g) => g.id);
    expect(await ids({})).toEqual([active.id, finished.id]);
    expect(await ids({ status: 'active' })).toEqual([active.id]);
    expect(await ids({ status: 'finished' })).toEqual([finished.id]);
    expect(await ids({ type: 'cash' })).toEqual([active.id, finished.id]);
    expect(await ids({ type: 'tournament' })).toEqual([]);
  });
});
