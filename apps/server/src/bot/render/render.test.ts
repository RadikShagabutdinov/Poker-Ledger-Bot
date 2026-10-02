import { describe, expect, it } from 'vitest';

import {
  addGuests,
  createTestDeps,
  currentVersion,
  playExample85,
  setupGame,
  BOB,
  CAROL,
  type TestDeps,
} from '../../services/testing';
import {
  buySelf,
  finishGame,
  loadGameMessageData,
  recordBuy,
  saveSettlement,
  type GameMessageData,
} from '../../services';
import { miniAppLinks } from '../links';
import { renderDeleted, renderReopened, renderResult } from './result';
import { renderFinishedStatus, renderStatus } from './status';

const links = miniAppLinks({ botUsername: 'poker_ledger_bot', miniAppShortName: 'app' });

/** Game ids are random; snapshots show a placeholder. */
function withoutId(value: unknown, gameId: string): unknown {
  return JSON.parse(JSON.stringify(value).replaceAll(gameId, '<gameId>')) as unknown;
}

function messageData(deps: TestDeps, gameId: string): GameMessageData {
  const data = loadGameMessageData(deps.db, gameId);
  if (!data) {
    throw new Error('game not found');
  }
  return data;
}

/** SPEC §8.5 game finished with `finalChips` for Петя, Коля, Дима. */
async function finishedExample(
  dimaChips: number,
): Promise<{ deps: TestDeps; gameId: string; ids: Awaited<ReturnType<typeof playExample85>> }> {
  const deps = createTestDeps();
  const { game } = await setupGame(deps);
  const ids = await playExample85(deps, game.id);
  await finishGame(deps, BOB, game.id, {
    finalChips: { [ids.petya]: 71_000, [ids.kolya]: 52_000, [ids.dima]: dimaChips },
    mismatch: { mode: 'proportional' },
    expectedVersion: currentVersion(deps, game.id),
  });
  return { deps, gameId: game.id, ids };
}

describe('status message (SPEC §13.2)', () => {
  it.each(['ru', 'en'] as const)('renders seated and left players in %s', async (language) => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    await playExample85(deps, game.id);
    const message = renderStatus(messageData(deps, game.id).state, language, links);
    expect(message.text).toMatchSnapshot();
    expect(withoutId(message.keyboard, game.id)).toMatchSnapshot();
  });

  it('renders an empty game', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    expect(renderStatus(messageData(deps, game.id).state, 'ru', links).text).toMatchSnapshot();
  });

  it('collapses more than 15 seated players to names and chips', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const names = Array.from({ length: 16 }, (_, i) => `Guest ${String(i + 1)}`);
    const ids = await addGuests(deps, game.id, names);
    for (const playerId of ids) {
      await recordBuy(deps, BOB, game.id, { playerId, chips: 30_000 });
    }
    await recordBuy(deps, BOB, game.id, { playerId: ids[0] as string, chips: 15_000 });
    const text = renderStatus(messageData(deps, game.id).state, 'ru', links).text;
    expect(text).toMatchSnapshot();
    expect(text).not.toContain('докуп');
  });

  it('escapes HTML in user strings (SEC-08)', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const [guest] = await addGuests(deps, game.id, ['<b>Tom</b> & Jerry']);
    await recordBuy(deps, BOB, game.id, { playerId: guest as string, chips: 30_000 });
    const text = renderStatus(messageData(deps, game.id).state, 'en', links).text;
    expect(text).toContain('&lt;b&gt;Tom&lt;/b&gt; &amp; Jerry');
    expect(text).not.toContain('<b>Tom');
  });

  it('has no mentions (SPEC §13.4)', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    await buySelf(deps, BOB, game.id, { expect: 'buy_in' });
    expect(renderStatus(messageData(deps, game.id).state, 'ru', links).text).not.toContain(
      'tg://user',
    );
  });

  it('renders the finished status without buttons', async () => {
    const { deps, gameId } = await finishedExample(30_000);
    const message = renderFinishedStatus(messageData(deps, gameId).state, 'ru');
    expect(message.keyboard).toBeUndefined();
    expect(message.text).toMatchSnapshot();
  });
});

describe('result message (SPEC §13.3)', () => {
  it.each(['ru', 'en'] as const)('renders results and transfers in %s', async (language) => {
    const { deps, gameId } = await finishedExample(30_000);
    const message = renderResult(messageData(deps, gameId), language, links);
    expect(message.text).toMatchSnapshot();
    expect(withoutId(message.keyboard, gameId)).toMatchSnapshot();
  });

  it.each(['ru', 'en'] as const)('warns about a chip mismatch in %s', async (language) => {
    const { deps, gameId } = await finishedExample(29_000);
    expect(renderResult(messageData(deps, gameId), language, links).text).toMatchSnapshot();
  });

  it('marks a manual settlement whose balances do not match', async () => {
    const { deps, gameId, ids } = await finishedExample(30_000);
    await saveSettlement(deps, BOB, gameId, {
      transfers: [{ from: ids.vasya, to: ids.petya, amount: 1_600 }],
      expectedVersion: currentVersion(deps, gameId),
    });
    const text = renderResult(messageData(deps, gameId), 'ru', links).text;
    expect(text).toMatchSnapshot();
    expect(text).toContain('✏️');
  });

  it('mentions Telegram players and never shows payment details', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const [guest] = await addGuests(deps, game.id, ['Guest']);
    await buySelf(deps, CAROL, game.id, { expect: 'buy_in' });
    await recordBuy(deps, BOB, game.id, { playerId: guest as string, chips: 30_000 });
    const carol = messageData(deps, game.id).state.players.find((p) => !p.isGuest);
    await finishGame(deps, BOB, game.id, {
      finalChips: { [carol?.playerId ?? '']: 45_000, [guest as string]: 15_000 },
      mismatch: { mode: 'proportional' },
      expectedVersion: currentVersion(deps, game.id),
    });
    const text = renderResult(messageData(deps, game.id), 'en', links).text;
    expect(text).toMatchSnapshot();
    expect(text).toContain(`<a href="tg://user?id=${String(CAROL.tgUserId)}">Carol</a>`);
  });

  it('renders reopened and deleted markers', () => {
    expect(renderReopened('Poker <15.09>', 'ru').text).toBe(
      '🔄 Игра «Poker &lt;15.09&gt;» переоткрыта. Итоги пересчитаются после завершения.',
    );
    expect(renderDeleted('Poker', 'en')).toEqual({ text: '🗑 “Poker” was deleted.' });
  });
});
