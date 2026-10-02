import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findChat } from '../db/repositories/chats';
import { findGame } from '../db/repositories/games';
import type { GameRow } from '../db/schema';
import { buySelf, deleteGame, finishGame, reopenGame, saveSettlement } from '../services';
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  currentVersion,
  playExample85,
  setupGame,
} from '../services/testing';
import { createTestBot, type TestBot } from './testing';
import { UPDATE_DELAY_MS } from './updater';

const gameRow = (t: TestBot, id: string) => findGame(t.deps.db, id) as GameRow;

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(UPDATE_DELAY_MS);
}

/** An active game whose pinned status message is already sent. */
async function startedGame(t: TestBot): Promise<string> {
  const { game } = await setupGame(t.deps);
  await settle();
  t.telegram.clear();
  return game.id;
}

async function finishExample(
  t: TestBot,
  gameId: string,
): Promise<Awaited<ReturnType<typeof playExample85>>> {
  const ids = await playExample85(t.deps, gameId);
  await finishGame(t.deps, BOB, gameId, {
    finalChips: { [ids.petya]: 71_000, [ids.kolya]: 52_000, [ids.dima]: 30_000 },
    mismatch: { mode: 'proportional' },
    expectedVersion: currentVersion(t.deps, gameId),
  });
  return ids;
}

describe('BotMessageUpdater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends and pins the status message of a new game without notification (V1-MSG-01)', async () => {
    const t = createTestBot();
    const { game } = await setupGame(t.deps);
    expect(t.telegram.calls).toEqual([]);
    await settle();
    const [sent] = t.telegram.callsOf('sendMessage');
    expect(sent).toMatchObject({ chat_id: -100123, parse_mode: 'HTML' });
    expect(t.telegram.callsOf('pinChatMessage')).toEqual([
      { chat_id: -100123, message_id: 100, disable_notification: true },
    ]);
    expect(gameRow(t, game.id).statusMessageId).toBe(100);
  });

  it('folds changes within 2 s into one edit (V1-MSG-07)', async () => {
    const t = createTestBot();
    const gameId = await startedGame(t);
    await buySelf(t.deps, BOB, gameId, { expect: 'buy_in' });
    await vi.advanceTimersByTimeAsync(500);
    await buySelf(t.deps, CAROL, gameId, { expect: 'buy_in' });
    await buySelf(t.deps, DAVE, gameId, { expect: 'buy_in' });
    await buySelf(t.deps, BOB, gameId, { expect: 'rebuy' });
    expect(t.telegram.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(UPDATE_DELAY_MS - 500);
    const edits = t.telegram.callsOf('editMessageText');
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ message_id: 100 });
    expect(String(edits[0]?.text)).toContain('Dave');
    expect(t.telegram.callsOf('sendMessage')).toEqual([]);
  });

  it('ignores «message is not modified»', async () => {
    const t = createTestBot();
    const gameId = await startedGame(t);
    t.telegram.fail('editMessageText', 400, 'Bad Request: message is not modified');
    t.deps.messageUpdater.schedule(gameId);
    await settle();
    expect(t.telegram.calls.map((c) => c.method)).toEqual(['editMessageText']);
  });

  it('sends and pins a new status message if the old one was deleted (V1-MSG-09)', async () => {
    const t = createTestBot();
    const gameId = await startedGame(t);
    t.telegram.fail('editMessageText', 400, 'Bad Request: message to edit not found');
    await buySelf(t.deps, BOB, gameId, { expect: 'buy_in' });
    await settle();
    expect(t.telegram.calls.map((c) => c.method)).toEqual([
      'editMessageText',
      'sendMessage',
      'pinChatMessage',
    ]);
    expect(gameRow(t, gameId).statusMessageId).toBe(101);
  });

  it('says once that it cannot pin without the right (V1-CHAT-02)', async () => {
    const t = createTestBot();
    t.telegram.fail(
      'pinChatMessage',
      400,
      'Bad Request: not enough rights to manage pinned messages in the chat',
    );
    const { game } = await setupGame(t.deps);
    await settle();
    const sent = t.telegram.callsOf('sendMessage');
    expect(sent).toHaveLength(2);
    expect(sent[1]?.text).toContain('Не получилось закрепить');
    expect(gameRow(t, game.id).statusMessageId).toBe(100);

    await buySelf(t.deps, BOB, game.id, { expect: 'buy_in' });
    await settle();
    expect(t.telegram.callsOf('sendMessage')).toHaveLength(2);
  });

  it('on finish unpins the status and sends the result without pinning (V1-FIN-07)', async () => {
    const t = createTestBot();
    const gameId = await startedGame(t);
    await finishExample(t, gameId);
    await settle();
    expect(t.telegram.calls.map((c) => c.method)).toEqual([
      'editMessageText',
      'unpinChatMessage',
      'sendMessage',
    ]);
    const [statusEdit] = t.telegram.callsOf('editMessageText');
    expect(statusEdit?.reply_markup).toBeUndefined();
    const [result] = t.telegram.callsOf('sendMessage');
    expect(String(result?.text)).toContain('завершена');
    expect(gameRow(t, gameId)).toMatchObject({ statusMessageId: null, resultMessageId: 101 });
  });

  it('edits the result message after a settlement edit (V1-SETL-06)', async () => {
    const t = createTestBot();
    const gameId = await startedGame(t);
    const ids = await finishExample(t, gameId);
    await settle();
    t.telegram.clear();
    await saveSettlement(t.deps, BOB, gameId, {
      transfers: [{ from: ids.vasya, to: ids.petya, amount: 1_600 }],
      expectedVersion: currentVersion(t.deps, gameId),
    });
    await settle();
    const edits = t.telegram.callsOf('editMessageText');
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ message_id: 101 });
    expect(String(edits[0]?.text)).toContain('✏️');
    expect(t.telegram.callsOf('sendMessage')).toEqual([]);
  });

  it('on reopen marks the result and pins a new status message (V1-EDIT-02)', async () => {
    const t = createTestBot();
    const gameId = await startedGame(t);
    const ids = await finishExample(t, gameId);
    await settle();
    t.telegram.clear();
    await reopenGame(t.deps, BOB, gameId);
    await settle();
    expect(t.telegram.calls.map((c) => c.method)).toEqual([
      'editMessageText',
      'sendMessage',
      'pinChatMessage',
    ]);
    expect(String(t.telegram.callsOf('editMessageText')[0]?.text)).toContain('переоткрыта');
    expect(gameRow(t, gameId)).toMatchObject({ statusMessageId: 102, resultMessageId: null });

    // Finishing again sends a new result message.
    t.telegram.clear();
    await finishGame(t.deps, BOB, gameId, {
      finalChips: { [ids.petya]: 71_000, [ids.kolya]: 52_000, [ids.dima]: 30_000 },
      mismatch: { mode: 'proportional' },
      expectedVersion: currentVersion(t.deps, gameId),
    });
    await settle();
    expect(t.telegram.calls.map((c) => c.method)).toEqual([
      'editMessageText',
      'unpinChatMessage',
      'sendMessage',
    ]);
    expect(gameRow(t, gameId)).toMatchObject({ statusMessageId: null, resultMessageId: 103 });
  });

  it('marks the messages of a deleted game and removes the buttons', async () => {
    const t = createTestBot();
    const gameId = await startedGame(t);
    await deleteGame(t.deps, BOB, gameId);
    await settle();
    expect(t.telegram.calls.map((c) => c.method)).toEqual(['editMessageText', 'unpinChatMessage']);
    expect(t.telegram.callsOf('editMessageText')[0]).toMatchObject({
      text: '🗑 Игра «Покер 15.09» удалена.',
    });
    expect(gameRow(t, gameId).statusMessageId).toBeNull();
  });

  it('marks the chat as left when the bot was removed', async () => {
    const t = createTestBot();
    const { chat, game } = await setupGame(t.deps);
    t.telegram.fail('sendMessage', 403, 'Forbidden: bot was kicked from the supergroup chat');
    await settle();
    expect(findChat(t.deps.db, chat.id)?.botStatus).toBe('left');
    t.telegram.clear();
    t.deps.setMembership(-100123, ALICE.tgUserId, 'admin');
    await buySelf(t.deps, ALICE, game.id, { expect: 'buy_in' });
    await settle();
    expect(t.telegram.calls).toEqual([]);
  });

  it('flush() runs pending updates at once', async () => {
    const t = createTestBot();
    await setupGame(t.deps);
    await t.updater.flush();
    expect(t.telegram.callsOf('sendMessage')).toHaveLength(1);
    await settle();
    expect(t.telegram.callsOf('sendMessage')).toHaveLength(1);
  });
});
