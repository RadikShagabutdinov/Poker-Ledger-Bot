import { describe, expect, it } from 'vitest';

import { listGameEvents } from '../db/repositories/gameEvents';
import { findChat } from '../db/repositories/chats';
import { updateChatSettings } from './chats';
import { addPlayerToGame, createGame, renderGameName, updateGame } from './games';
import { getGameState } from './state';
import { BOB, CAROL, MALLORY, START_TIME, createTestDeps, setupChat, setupGame } from './testing';

describe('createGame', () => {
  it('names the game by the template and increments the counter', async () => {
    const deps = createTestDeps();
    const chat = setupChat(deps);
    await updateChatSettings(deps, BOB, chat.id, { gameNameTemplate: 'Игра №{n}, {date}' });
    const game = await createGame(deps, BOB, chat.id);
    expect(game.name).toBe('Игра №1, 15.09');
    expect(findChat(deps.db, chat.id)?.gameCounter).toBe(1);
    expect(game.id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(listGameEvents(deps.db, game.id).map((e) => e.type)).toEqual(['game_created']);
    expect(deps.scheduled).toEqual([game.id]);
  });

  it('formats {date} in the configured time zone and chat locale', () => {
    // 22:30 UTC on 15.09 is already 16.09 in Moscow.
    const late = Date.UTC(2026, 8, 15, 22, 30);
    expect(
      renderGameName('{date}', { language: 'ru', timeZone: 'Europe/Moscow', now: late, n: 1 }),
    ).toBe('16.09');
    expect(
      renderGameName('{date}', { language: 'en', timeZone: 'UTC', now: START_TIME, n: 1 }),
    ).toBe('09/15');
  });

  it('allows one active game per chat', async () => {
    const deps = createTestDeps();
    const { chat, game } = await setupGame(deps);
    await expect(createGame(deps, CAROL, chat.id)).rejects.toMatchObject({
      code: 'ACTIVE_GAME_EXISTS',
      details: { gameId: game.id },
    });
    expect(findChat(deps.db, chat.id)?.gameCounter).toBe(1);
  });

  it('takes a custom name and stack, rejects outsiders and tournaments in V1', async () => {
    const deps = createTestDeps();
    const chat = setupChat(deps);
    await expect(createGame(deps, MALLORY, chat.id)).rejects.toMatchObject({
      code: 'NOT_CHAT_MEMBER',
    });
    await expect(createGame(deps, BOB, chat.id, { type: 'tournament' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const game = await createGame(deps, BOB, chat.id, {
      name: 'Пятница',
      stack: { chips: 10_000, amount: 500 },
    });
    expect(game).toMatchObject({ name: 'Пятница', stackChips: 10_000, stackAmount: 500 });
  });
});

describe('updateGame', () => {
  it('changes name and stack of an active game with a settings_changed event', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const updated = await updateGame(deps, CAROL, game.id, {
      name: 'Новое',
      stack: { chips: 20_000, amount: 1_000 },
    });
    expect(updated).toMatchObject({ name: 'Новое', stackChips: 20_000 });
    const last = listGameEvents(deps.db, game.id).at(-1);
    expect(last).toMatchObject({
      type: 'settings_changed',
      payload: {
        name: { from: game.name, to: 'Новое' },
        stack: { from: { chips: 30_000, amount: 1_000 }, to: { chips: 20_000, amount: 1_000 } },
      },
    });
    expect((await getGameState(deps, BOB, game.id)).version).toBe(2);
    expect(deps.scheduled).toEqual([game.id]);
  });
});

describe('addPlayerToGame', () => {
  it('adds known players, guests and self in seat order; re-adding is a no-op', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const carol = await addPlayerToGame(deps, CAROL, game.id, { self: true });
    const guest = await addPlayerToGame(deps, BOB, game.id, { guestName: 'Гость' });
    const again = await addPlayerToGame(deps, BOB, game.id, { playerId: carol.playerId });
    expect(carol.added && guest.added).toBe(true);
    expect(again).toEqual({ playerId: carol.playerId, added: false });
    const state = await getGameState(deps, BOB, game.id);
    expect(state.players.map((p) => [p.name, p.seatOrder, p.status])).toEqual([
      ['Carol', 1, 'not_joined'],
      ['Гость', 2, 'not_joined'],
    ]);
    await expect(
      addPlayerToGame(deps, BOB, game.id, { playerId: 'missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
