import { describe, expect, it } from 'vitest';

import { TelegramMembershipChecker } from '../bot/membership';
import { FakeTelegram, fakeApi } from '../bot/testing';
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  MALLORY,
  TG_CHAT_ID,
  addGuests,
  currentVersion,
  setupChat,
} from '../services/testing';
import { createTestApp } from './testing';

/** The API with the real membership checker over a mocked Bot API (SEC-02). */
function setup() {
  const telegram = new FakeTelegram();
  let now = 0;
  const membership = new TelegramMembershipChecker(fakeApi(telegram), () => now);
  const app = createTestApp({ membership });
  const chat = setupChat(app.deps);
  telegram.setMember(TG_CHAT_ID, ALICE.tgUserId, 'creator');
  telegram.setMember(TG_CHAT_ID, BOB.tgUserId, 'member');
  telegram.setMember(TG_CHAT_ID, CAROL.tgUserId, 'restricted');
  telegram.setMember(TG_CHAT_ID, DAVE.tgUserId, 'member');
  return {
    ...app,
    telegram,
    chat,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('chat membership (SEC-02)', () => {
  it('lets members in, including restricted members with is_member', async () => {
    const t = setup();
    expect(await t.json(ALICE, 'GET', `/chats/${t.chat.id}`)).toMatchObject({ isAdmin: true });
    expect(await t.json(BOB, 'GET', `/chats/${t.chat.id}`)).toMatchObject({ isAdmin: false });
    expect(await t.json(CAROL, 'GET', `/chats/${t.chat.id}`)).toMatchObject({ isAdmin: false });
  });

  it('rejects non-members with NOT_CHAT_MEMBER', async () => {
    const t = setup();
    const response = await t.call(MALLORY, 'GET', `/chats/${t.chat.id}/players`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'NOT_CHAT_MEMBER' } });
  });

  it('caches getChatMember for 10 minutes', async () => {
    const t = setup();
    await t.json(BOB, 'GET', `/chats/${t.chat.id}`);
    await t.json(BOB, 'GET', `/chats/${t.chat.id}/players`);
    expect(t.telegram.callsOf('getChatMember')).toHaveLength(1);
    t.telegram.setMember(TG_CHAT_ID, BOB.tgUserId, 'left');
    await t.json(BOB, 'GET', `/chats/${t.chat.id}`);
    t.advance(10 * 60 * 1000);
    expect((await t.call(BOB, 'GET', `/chats/${t.chat.id}`)).status).toBe(403);
    expect(t.telegram.callsOf('getChatMember')).toHaveLength(2);
  });

  it('a player who left the chat still sees the finished game, not an active one', async () => {
    const t = setup();
    const { game } = await t.json<{ game: { id: string } }>(
      BOB,
      'POST',
      `/chats/${t.chat.id}/games`,
      {},
      201,
    );
    const { playerId } = await t.json<{ playerId: string }>(
      DAVE,
      'POST',
      `/games/${game.id}/players`,
      { self: true },
    );
    const [guest] = await addGuests(t.deps, game.id, ['Гость']);
    await t.json(DAVE, 'POST', `/games/${game.id}/events`, { type: 'buy', playerId, chips: 1000 });
    await t.json(DAVE, 'POST', `/games/${game.id}/events`, {
      type: 'buy',
      playerId: guest,
      chips: 1000,
    });

    t.telegram.setMember(TG_CHAT_ID, DAVE.tgUserId, 'left');
    t.advance(10 * 60 * 1000);
    expect((await t.call(DAVE, 'GET', `/games/${game.id}`)).status).toBe(403);

    await t.json(BOB, 'POST', `/games/${game.id}/finish`, {
      finalChips: { [playerId]: 1500, [guest as string]: 500 },
      mismatchMode: 'proportional',
      expectedVersion: currentVersion(t.deps, game.id),
    });
    expect(await t.json(DAVE, 'GET', `/games/${game.id}`)).toMatchObject({
      status: 'finished',
      myPlayerId: playerId,
      permissions: { canManage: false, canEditFinished: false, canEditSettlement: false },
    });
    await t.json(DAVE, 'GET', `/games/${game.id}/log`);
    await t.json(DAVE, 'GET', `/games/${game.id}/settlement`);
    // Viewing only: edits need membership.
    const reset = await t.call(DAVE, 'POST', `/games/${game.id}/settlement/reset`);
    expect(reset.status).toBe(403);
    expect((await t.call(DAVE, 'GET', `/chats/${t.chat.id}`)).status).toBe(403);
  });
});
