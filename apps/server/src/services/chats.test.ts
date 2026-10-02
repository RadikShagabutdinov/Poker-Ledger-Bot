import { describe, expect, it } from 'vitest';

import { findChat } from '../db/repositories/chats';
import { findGame } from '../db/repositories/games';
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  MALLORY,
  TG_CHAT_ID,
  actor,
  createTestDeps,
  setupChat,
  setupGame,
} from './testing';
import { getChat, migrateChat, registerChat, setBotStatus, updateChatSettings } from './chats';
import { addGuest, listPlayers, renamePlayer } from './players';
import { getProfile, listMyChats, updateProfile } from './profile';
import { getGameState } from './state';
import { addPlayerToGame, createGame } from './games';

describe('chats', () => {
  it('creates a chat with defaults in the language of the user who added the bot', async () => {
    const deps = createTestDeps();
    const chat = setupChat(deps);
    expect(chat).toMatchObject({
      language: 'ru',
      currency: 'RUB',
      stackChips: 30_000,
      stackAmount: 1_000,
      quickBuyins: [1, 0.5],
      gameNameTemplate: 'Покер {date}',
      botStatus: 'admin',
      gameCounter: 0,
    });
    expect(await getChat(deps, ALICE, chat.id)).toMatchObject({ isAdmin: true });
    expect(await getChat(deps, BOB, chat.id)).toMatchObject({ isAdmin: false });
    // The template default is «Покер {date}» and no game exists yet.
    expect((await getChat(deps, BOB, chat.id)).nextGameName).toMatch(/^Покер \d{2}\.\d{2}$/);
  });

  it('chooses the chat language by the adder: en for other codes, ru when unknown', () => {
    const deps = createTestDeps();
    const en = registerChat(deps, {
      tgChatId: 1,
      title: 'en',
      botStatus: 'member',
      addedBy: actor(10, 'John', { languageCode: 'de' }),
    });
    const unknown = registerChat(deps, { tgChatId: 2, title: 'x', botStatus: 'member' });
    expect(en.chat.language).toBe('en');
    expect(en.chat.gameNameTemplate).toBe('Poker {date}');
    expect(unknown.chat.language).toBe('ru');
  });

  it('keeps data when the bot leaves and restores it on re-adding', async () => {
    const deps = createTestDeps();
    const { chat } = await setupGame(deps);
    setBotStatus(deps, TG_CHAT_ID, 'left');
    expect(findChat(deps.db, chat.id)?.botStatus).toBe('left');
    const again = registerChat(deps, {
      tgChatId: TG_CHAT_ID,
      title: 'Renamed',
      botStatus: 'member',
    });
    expect(again).toMatchObject({ created: false, chat: { id: chat.id, title: 'Renamed' } });
  });

  it('migration to a supergroup keeps all data', async () => {
    const deps = createTestDeps();
    const { chat, game } = await setupGame(deps);
    migrateChat(deps, TG_CHAT_ID, -100999);
    expect(findChat(deps.db, chat.id)?.tgChatId).toBe(-100999);
    deps.setMembership(-100999, BOB.tgUserId, 'member');
    expect((await getGameState(deps, BOB, game.id)).id).toBe(game.id);
  });

  it('migration replaces an empty chat registered under the new id first', async () => {
    const deps = createTestDeps();
    const { chat } = await setupGame(deps);
    const early = registerChat(deps, {
      tgChatId: -100999,
      title: 'Poker club',
      botStatus: 'admin',
    });
    migrateChat(deps, TG_CHAT_ID, -100999);
    expect(findChat(deps.db, early.chat.id)).toBeUndefined();
    expect(findChat(deps.db, chat.id)).toMatchObject({ tgChatId: -100999, botStatus: 'admin' });
    // Repeating the migration is a no-op.
    migrateChat(deps, TG_CHAT_ID, -100999);
    expect(findChat(deps.db, chat.id)?.tgChatId).toBe(-100999);
  });

  it('migration does not overwrite a target chat that has data', async () => {
    const deps = createTestDeps();
    const { chat } = await setupGame(deps);
    const other = setupChat(deps, -100999);
    await createGame(deps, ALICE, other.id);
    migrateChat(deps, TG_CHAT_ID, -100999);
    expect(findChat(deps.db, chat.id)?.tgChatId).toBe(TG_CHAT_ID);
  });

  it('validates settings and lets any member change them', async () => {
    const deps = createTestDeps();
    const chat = setupChat(deps);
    const view = await updateChatSettings(deps, BOB, chat.id, {
      currency: 'USD',
      stack: { chips: 10_000, amount: 50 },
      quickBuyins: [1, 0.5, 0.25],
    });
    expect(view).toMatchObject({ currency: 'USD', stack: { chips: 10_000, amount: 50 } });
    await expect(updateChatSettings(deps, BOB, chat.id, { currency: 'XXZ' })).rejects.toMatchObject(
      { code: 'VALIDATION' },
    );
    await expect(
      updateChatSettings(deps, MALLORY, chat.id, { currency: 'EUR' }),
    ).rejects.toMatchObject({ code: 'NOT_CHAT_MEMBER' });
  });

  it('games snapshot chat settings', async () => {
    const deps = createTestDeps();
    const { chat, game } = await setupGame(deps);
    await updateChatSettings(deps, BOB, chat.id, {
      currency: 'EUR',
      stack: { chips: 1_000, amount: 10 },
    });
    expect(findGame(deps.db, game.id)).toMatchObject({
      currency: 'RUB',
      stackChips: 30_000,
      stackAmount: 1_000,
    });
  });
});

describe('players', () => {
  it('guests are unique per chat ignoring case, Cyrillic included', async () => {
    const deps = createTestDeps();
    const chat = setupChat(deps);
    const vasya = await addGuest(deps, BOB, chat.id, '  Вася ');
    expect(vasya).toMatchObject({ name: 'Вася', isGuest: true });
    await expect(addGuest(deps, BOB, chat.id, 'ВАСЯ')).rejects.toMatchObject({
      code: 'GUEST_NAME_TAKEN',
      details: { playerId: vasya.playerId },
    });
    await expect(addGuest(deps, BOB, chat.id, 'x'.repeat(41))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('creates a Telegram player on first interaction and renames it', async () => {
    const deps = createTestDeps();
    const { chat, game } = await setupGame(deps);
    const { playerId } = await addPlayerToGame(deps, CAROL, game.id, { self: true });
    // Bob becomes a player by opening the chat.
    const players = await listPlayers(deps, BOB, chat.id);
    expect(players).toHaveLength(2);
    expect(players).toContainEqual({ playerId, name: 'Carol', isGuest: false });
    expect(players.map((p) => p.name)).toContain('Bob');
    expect(await renamePlayer(deps, BOB, chat.id, playerId, 'Кэрол')).toMatchObject({
      name: 'Кэрол',
    });
    expect(await renamePlayer(deps, BOB, chat.id, playerId, null)).toMatchObject({
      name: 'Carol',
    });
  });

  it('refreshes the Telegram name on every interaction', async () => {
    const deps = createTestDeps();
    const { chat, game } = await setupGame(deps);
    await addPlayerToGame(deps, CAROL, game.id, { self: true });
    await getChat(deps, { ...CAROL, firstName: 'Caroline', lastName: 'K.' }, chat.id);
    expect((await listPlayers(deps, DAVE, chat.id)).map((p) => p.name)).toContain('Caroline K.');
  });
});

describe('profile', () => {
  it('stores language and payment details, and clears them', () => {
    const deps = createTestDeps();
    expect(getProfile(deps, ALICE)).toMatchObject({ language: null, effectiveLanguage: 'ru' });
    expect(getProfile(deps, BOB)).toMatchObject({ effectiveLanguage: 'en' });
    const updated = updateProfile(deps, ALICE, {
      language: 'en',
      payPhone: '+79990000000',
      payBank: 'Т-Банк',
      payNote: 'только наличные',
    });
    expect(updated).toMatchObject({ effectiveLanguage: 'en', payBank: 'Т-Банк' });
    expect(updateProfile(deps, ALICE, { payPhone: null, payNote: null })).toMatchObject({
      payPhone: null,
      payBank: 'Т-Банк',
      payNote: null,
    });
    expect(() => updateProfile(deps, ALICE, { payNote: 'x'.repeat(201) })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
  });

  it('lists chats where the user plays, with active games', async () => {
    const deps = createTestDeps();
    const { chat, game } = await setupGame(deps);
    await addPlayerToGame(deps, CAROL, game.id, { self: true });
    expect(listMyChats(deps, CAROL)).toEqual([
      { chatId: chat.id, title: 'Poker club', activeGameIds: [game.id] },
    ]);
    expect(listMyChats(deps, BOB)).toEqual([]);
  });
});

describe('opening a game', () => {
  it('makes a member a chat player and reports their game player', async () => {
    const deps = createTestDeps();
    const { chat, game } = await setupGame(deps);
    expect((await getGameState(deps, DAVE, game.id)).myPlayerId).toBeNull();
    expect((await listPlayers(deps, BOB, chat.id)).map((p) => p.name)).toContain('Dave');
    const { playerId } = await addPlayerToGame(deps, DAVE, game.id, { self: true });
    expect((await getGameState(deps, DAVE, game.id)).myPlayerId).toBe(playerId);
    expect((await getGameState(deps, BOB, game.id)).myPlayerId).toBeNull();
  });
});
