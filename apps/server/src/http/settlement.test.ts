import { settlementResponseSchema } from '@pokerledger/shared';
import { describe, expect, it } from 'vitest';

import { updateProfile } from '../services';
import { ALICE, BOB, CAROL, DAVE, currentVersion, setupChat } from '../services/testing';
import { createTestApp } from './testing';

const PHONE = '+79991234567';
const BANK = 'Секретный банк';

/** A finished game: Carol won 1 000 from Dave; Carol filled in payment details. Alice (admin) did not play. */
async function finishedGame() {
  const t = createTestApp();
  const chat = setupChat(t.deps);
  updateProfile(t.deps, CAROL, { payPhone: PHONE, payBank: BANK });
  const { game } = await t.json<{ game: { id: string } }>(
    BOB,
    'POST',
    `/chats/${chat.id}/games`,
    {},
    201,
  );
  const gid = game.id;
  const ids: Record<string, string> = {};
  for (const actor of [CAROL, DAVE]) {
    const { playerId } = await t.json<{ playerId: string }>(
      actor,
      'POST',
      `/games/${gid}/players`,
      {
        self: true,
      },
    );
    ids[actor.firstName] = playerId;
    await t.json(actor, 'POST', `/games/${gid}/events`, { type: 'buy', playerId, chips: 30_000 });
  }
  const carol = ids.Carol as string;
  const dave = ids.Dave as string;
  const finish = {
    finalChips: { [carol]: 60_000, [dave]: 0 },
    mismatchMode: 'proportional',
    expectedVersion: currentVersion(t.deps, gid),
  };
  await t.json(BOB, 'POST', `/games/${gid}/finish`, finish);
  return { t, chat, gid, carol, dave, finish };
}

describe('settlement and payment details (SEC-04)', () => {
  it('shows payment details only to players of the game', async () => {
    const { t, gid, carol, dave } = await finishedGame();
    const forDave = settlementResponseSchema.parse(
      await t.json(DAVE, 'GET', `/games/${gid}/settlement`),
    );
    expect(forDave.transfers).toEqual([
      {
        from: dave,
        to: carol,
        amount: 1_000,
        recipientPayment: { phone: PHONE, bank: BANK, note: null },
      },
    ]);
    // Alice is an admin but did not play; Bob created the game but did not play.
    for (const viewer of [ALICE, BOB]) {
      const body = await t.json(viewer, 'GET', `/games/${gid}/settlement`);
      expect(JSON.stringify(body)).not.toContain(PHONE);
    }
  });

  it('never leaks payment details into other responses or logs', async () => {
    const { t, chat, gid, carol, dave } = await finishedGame();
    const responses = [
      await t.json(CAROL, 'GET', `/games/${gid}`),
      await t.json(CAROL, 'GET', `/games/${gid}/log`),
      await t.json(CAROL, 'GET', `/chats/${chat.id}`),
      await t.json(CAROL, 'GET', `/chats/${chat.id}/players`),
      await t.json(CAROL, 'GET', `/chats/${chat.id}/games`),
      await t.json(CAROL, 'GET', '/me/chats'),
      await t.json(BOB, 'PUT', `/games/${gid}/settlement`, {
        transfers: [{ from: dave, to: carol, amount: 900 }],
        expectedVersion: currentVersion(t.deps, gid),
      }),
      await t.json(ALICE, 'POST', `/games/${gid}/settlement/reset`),
    ];
    for (const body of responses) {
      const text = JSON.stringify(body);
      expect(text).not.toContain(PHONE);
      expect(text).not.toContain(BANK);
    }
    await t.json(CAROL, 'PATCH', '/me', { payNote: 'карта 1234' });
    const logs = t.logs.join('\n');
    expect(logs).not.toContain(PHONE);
    expect(logs).not.toContain('карта 1234');
    expect(logs).not.toContain('tma ');
    expect(logs).not.toContain('hash=');
  });

  it('saves a manual settlement with warnings; editors are players, the creator and admins', async () => {
    const { t, gid, carol, dave } = await finishedGame();
    const saved = settlementResponseSchema.parse(
      await t.json(DAVE, 'PUT', `/games/${gid}/settlement`, {
        transfers: [{ from: dave, to: carol, amount: 900 }],
        expectedVersion: currentVersion(t.deps, gid),
      }),
    );
    expect(saved.isManual).toBe(true);
    // The editor is a player: payment details stay in the answer.
    expect(saved.transfers[0]?.recipientPayment?.phone).toBe(PHONE);
    expect(saved.warnings).toEqual([
      { code: 'BALANCE_MISMATCH', playerId: carol, delta: -100 },
      { code: 'BALANCE_MISMATCH', playerId: dave, delta: 100 },
    ]);
    // Self-transfers and non-positive amounts are rejected (V1-SETL-05).
    const invalid = await t.call(BOB, 'PUT', `/games/${gid}/settlement`, {
      body: {
        transfers: [{ from: dave, to: dave, amount: 0 }],
        expectedVersion: currentVersion(t.deps, gid),
      },
    });
    expect(invalid.status).toBe(422);
    // Alice is an admin; a plain member who did not play is not allowed.
    const reset = await t.json(ALICE, 'POST', `/games/${gid}/settlement/reset`);
    expect(settlementResponseSchema.parse(reset).isManual).toBe(false);
  });

  it('returns 409 CONFLICT on a stale version for finish and settlement save', async () => {
    const { t, gid, carol, dave, finish } = await finishedGame();
    const stale = finish.expectedVersion;
    const put = await t.call(DAVE, 'PUT', `/games/${gid}/settlement`, {
      body: { transfers: [{ from: dave, to: carol, amount: 1_000 }], expectedVersion: stale },
    });
    expect(put.status).toBe(409);
    expect(await put.json()).toEqual({
      error: { code: 'CONFLICT', details: { version: currentVersion(t.deps, gid) } },
    });

    await t.json(BOB, 'POST', `/games/${gid}/reopen`);
    const finishStale = await t.call(BOB, 'POST', `/games/${gid}/finish`, {
      body: { ...finish, expectedVersion: stale },
    });
    expect(finishStale.status).toBe(409);
    expect(await finishStale.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  });
});
