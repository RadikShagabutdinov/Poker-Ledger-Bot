import {
  addGamePlayerResponseSchema,
  chatResponseSchema,
  eventMutationResponseSchema,
  finishPreviewResponseSchema,
  finishResponseSchema,
  gameLogResponseSchema,
  gameMutationResponseSchema,
  historyPageResponseSchema,
  myChatsResponseSchema,
  playersResponseSchema,
  settlementResponseSchema,
  type GameStateResponse,
} from '@pokerledger/shared';
import type { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { buySelf, createGame, deleteGame, finishGame } from '../services';
import { ALICE, BOB, CAROL, currentVersion, setupChat } from '../services/testing';
import { createTestApp, type TestApp } from './testing';

/** Parses with the shared response schema and checks nothing was stripped. */
function shaped<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.parse(body);
  expect(parsed).toEqual(body);
  return parsed;
}

async function newGame(t: TestApp, chatId: string): Promise<GameStateResponse> {
  const body = await t.json(BOB, 'POST', `/chats/${chatId}/games`, {}, 201);
  return shaped(gameMutationResponseSchema, body).game;
}

describe('game flow through the API', () => {
  it('plays, finishes, edits, reopens and deletes a game; every mutation updates the chat message', async () => {
    const t = createTestApp();
    const chat = setupChat(t.deps);
    const scheduledAfter = async (run: () => Promise<unknown>) => {
      t.deps.scheduled.length = 0;
      await run();
      expect(t.deps.scheduled).not.toHaveLength(0);
    };

    shaped(chatResponseSchema, await t.json(BOB, 'GET', `/chats/${chat.id}`));
    let game!: GameStateResponse;
    await scheduledAfter(async () => {
      game = await newGame(t, chat.id);
    });
    expect(game).toMatchObject({ status: 'active', stack: { chips: 30_000, amount: 1_000 } });
    const gid = game.id;
    // V1-GAME-03: one active game per chat.
    const second = await t.call(BOB, 'POST', `/chats/${chat.id}/games`, { body: {} });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      error: { code: 'ACTIVE_GAME_EXISTS', details: { gameId: gid } },
    });

    let vasya = '';
    let me = '';
    await scheduledAfter(async () => {
      const added = shaped(
        addGamePlayerResponseSchema,
        await t.json(BOB, 'POST', `/games/${gid}/players`, { guestName: 'Вася' }),
      );
      vasya = added.playerId;
      const self = shaped(
        addGamePlayerResponseSchema,
        await t.json(CAROL, 'POST', `/games/${gid}/players`, { self: true }),
      );
      me = self.playerId;
      expect(self.game.myPlayerId).toBe(me);
    });
    const guestTaken = await t.call(BOB, 'POST', `/games/${gid}/players`, {
      body: { guestName: 'вася' },
    });
    expect(await guestTaken.json()).toEqual({
      error: { code: 'GUEST_NAME_TAKEN', details: { playerId: vasya } },
    });

    // `buy` becomes a buy-in, then a rebuy (V1-PLAY-05).
    const buy = (playerId: string, chips: number) =>
      t.json(BOB, 'POST', `/games/${gid}/events`, { type: 'buy', playerId, chips });
    await scheduledAfter(async () => {
      const first = shaped(eventMutationResponseSchema, await buy(vasya, 30_000));
      expect(first.event).toMatchObject({ type: 'buy_in', chips: 30_000 });
    });
    const rebuy = shaped(eventMutationResponseSchema, await buy(vasya, 15_000));
    expect(rebuy.event).toMatchObject({ type: 'rebuy' });
    await buy(me, 30_000);

    await scheduledAfter(() =>
      t.json(BOB, 'POST', `/games/${gid}/events/${String(rebuy.event?.eventId)}/cancel`),
    );
    await t.json(BOB, 'POST', `/games/${gid}/events`, {
      type: 'cash_out',
      playerId: me,
      chips: 40_000,
    });
    await scheduledAfter(async () => {
      const undone = shaped(
        eventMutationResponseSchema,
        await t.json(BOB, 'POST', `/games/${gid}/undo`),
      );
      expect(undone.event).toMatchObject({ type: 'cash_out', playerId: me });
    });
    await scheduledAfter(() =>
      t.json(BOB, 'PATCH', `/games/${gid}`, {
        name: 'Пятница',
        stack: { chips: 30_000, amount: 1_500 },
      }),
    );

    const log = shaped(gameLogResponseSchema, await t.json(BOB, 'GET', `/games/${gid}/log`));
    expect(log.entries.filter((e) => e.cancelled !== null)).toHaveLength(2);

    const finishBody = {
      finalChips: { [vasya]: 20_000, [me]: 39_000 },
      mismatchMode: 'single_player',
      mismatchPlayerId: vasya,
    };
    const preview = shaped(
      finishPreviewResponseSchema,
      await t.json(BOB, 'POST', `/games/${gid}/finish/preview`, finishBody),
    );
    expect(preview.mismatchChips).toBe(-1_000);
    const missing = await t.call(BOB, 'POST', `/games/${gid}/finish/preview`, {
      body: { finalChips: {}, mismatchMode: 'proportional' },
    });
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ error: { code: 'MISSING_FINAL_CHIPS' } });

    const version = currentVersion(t.deps, gid);
    let finished!: z.output<typeof finishResponseSchema>;
    await scheduledAfter(async () => {
      finished = shaped(
        finishResponseSchema,
        await t.json(BOB, 'POST', `/games/${gid}/finish`, {
          ...finishBody,
          expectedVersion: version,
        }),
      );
    });
    expect(finished.result).toEqual(preview);
    expect(finished.game.status).toBe('finished');
    // Vasya −10 000 chips, the −1 000 mismatch is put on him: −9 000; Carol +9 000.
    // 30 000 chips = 1 500, so ∓450.
    expect(finished.game.players.map((p) => p.moneyResult)).toEqual([-450, 450]);

    // Finished-game edit: only the creator or an admin (V1-EDIT-01).
    const byCarol = await t.call(CAROL, 'POST', `/games/${gid}/edit`, {
      body: { replace: [{ eventId: 1, chips: 1 }] },
    });
    expect(byCarol.status).toBe(403);
    const cashOut = shaped(
      gameLogResponseSchema,
      await t.json(BOB, 'GET', `/games/${gid}/log`),
    ).entries.find((e) => e.type === 'cash_out' && e.playerId === vasya && e.cancelled === null);
    await scheduledAfter(() =>
      t.json(ALICE, 'POST', `/games/${gid}/edit`, {
        replace: [{ eventId: cashOut?.id, chips: 21_000 }],
      }),
    );
    const mismatch = shaped(
      gameMutationResponseSchema,
      await t.json(BOB, 'PATCH', `/games/${gid}`, { mismatchMode: 'proportional' }),
    );
    expect(mismatch.game.mismatch).toMatchObject({ mode: 'proportional', chips: 0 });
    const mixed = await t.call(BOB, 'PATCH', `/games/${gid}`, {
      body: { name: 'x', mismatchMode: 'proportional' },
    });
    expect(await mixed.json()).toMatchObject({
      error: { code: 'VALIDATION', details: { reason: 'MISMATCH_WITH_OTHER_FIELDS' } },
    });

    shaped(settlementResponseSchema, await t.json(CAROL, 'GET', `/games/${gid}/settlement`));
    const history = shaped(
      historyPageResponseSchema,
      await t.json(BOB, 'GET', `/chats/${chat.id}/games?status=finished&type=cash`),
    );
    expect(history.items.map((g) => g.id)).toEqual([gid]);
    shaped(myChatsResponseSchema, await t.json(CAROL, 'GET', '/me/chats'));
    shaped(playersResponseSchema, await t.json(BOB, 'GET', `/chats/${chat.id}/players`));

    await scheduledAfter(async () => {
      const reopened = shaped(
        gameMutationResponseSchema,
        await t.json(BOB, 'POST', `/games/${gid}/reopen`, {}),
      );
      expect(reopened.game.status).toBe('active');
    });
    await scheduledAfter(async () => {
      const deleted = await t.call(BOB, 'DELETE', `/games/${gid}`);
      expect(deleted.status).toBe(204);
    });
    expect((await t.call(BOB, 'GET', `/games/${gid}`)).status).toBe(404);
  });

  it('pages history with a cursor and filters by period (V1-HIST-01/02/04)', async () => {
    const t = createTestApp();
    const chat = setupChat(t.deps);
    const visible: string[] = [];
    for (let i = 0; i < 22; i++) {
      const game = await createGame(t.deps, BOB, chat.id);
      const { playerId } = await buySelf(t.deps, CAROL, game.id, { expect: 'buy_in' });
      await finishGame(t.deps, BOB, game.id, {
        finalChips: { [playerId]: 30_000 },
        mismatch: { mode: 'proportional' },
        expectedVersion: currentVersion(t.deps, game.id),
      });
      visible.unshift(game.id);
      t.deps.advance(1000);
    }
    const deleted = await createGame(t.deps, BOB, chat.id);
    await deleteGame(t.deps, BOB, deleted.id);

    const first = shaped(
      historyPageResponseSchema,
      await t.json(BOB, 'GET', `/chats/${chat.id}/games`),
    );
    expect(first.items).toHaveLength(20);
    const second = shaped(
      historyPageResponseSchema,
      await t.json(
        BOB,
        'GET',
        `/chats/${chat.id}/games?cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
      ),
    );
    expect([...first.items, ...second.items].map((g) => g.id)).toEqual(visible);
    expect(second.nextCursor).toBeNull();

    const from = first.items[1]?.startedAt ?? 0;
    const recent = shaped(
      historyPageResponseSchema,
      await t.json(BOB, 'GET', `/chats/${chat.id}/games?from=${String(from)}`),
    );
    expect(recent.items.map((g) => g.id)).toEqual(visible.slice(0, 2));
    const bad = await t.call(BOB, 'GET', `/chats/${chat.id}/games?cursor=@@@`);
    expect(await bad.json()).toMatchObject({
      error: { code: 'VALIDATION', details: { reason: 'INVALID_CURSOR' } },
    });
    const badPeriod = await t.call(BOB, 'GET', `/chats/${chat.id}/games?from=yesterday`);
    expect(badPeriod.status).toBe(422);
  });
});
