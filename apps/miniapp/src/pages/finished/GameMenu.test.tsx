import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import {
  apiError,
  CHAT,
  game,
  logEntry,
  plain,
  player,
  renderApp,
  type Routes,
} from '../../test/testUtils';

const GAME_ID = 'game00000001';

const finished = game({
  status: 'finished',
  version: 9,
  finishedAt: 1_757_910_000_000,
  players: [
    player('p1', 'Вася', {
      status: 'left',
      inChips: 60_000,
      outChips: 45_000,
      rebuyCount: 1,
      moneyResult: -500,
    }),
    player('p2', 'Петя', { seatOrder: 2, status: 'left', outChips: 45_000, moneyResult: 500 }),
  ],
  permissions: { canManage: true, canEditFinished: true, canEditSettlement: true },
});

const log = {
  entries: [
    logEntry(1, {
      type: 'game_created',
      playerId: null,
      playerName: null,
      chips: null,
      createdBy: { tgUserId: 100, name: 'Вася Создатель' },
    }),
    logEntry(2),
    logEntry(3, { type: 'cash_out', chips: 45_000 }),
  ],
};

function routes(overrides: Routes = {}, state = finished): Routes {
  return {
    [`GET /games/${GAME_ID}`]: { body: state },
    [`GET /games/${GAME_ID}/log`]: { body: log },
    ...overrides,
  };
}

let confirmSpy: MockInstance<typeof window.confirm>;

beforeEach(() => {
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('finished game menu', () => {
  it('is hidden from an ordinary chat member', async () => {
    const member = game({
      ...finished,
      permissions: { canManage: true, canEditFinished: false, canEditSettlement: false },
    });
    renderApp(`/games/${GAME_ID}`, routes({}, member));
    expect(await screen.findByRole('tab', { name: 'Итоги' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Меню' })).toBeNull();
  });

  it('lets the creator reopen the game', async () => {
    const reopened = game({ ...finished, status: 'active', version: 10, finishedAt: null });
    const { mutations } = renderApp(
      `/games/${GAME_ID}`,
      routes({ [`POST /games/${GAME_ID}/reopen`]: { body: { game: reopened } } }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Меню' }));
    const menu = screen.getByRole('dialog', { name: 'Меню' });
    expect(within(menu).getByRole('button', { name: 'Редактировать' })).toBeDefined();
    await userEvent.click(within(menu).getByRole('button', { name: 'Переоткрыть' }));
    expect(await screen.findByRole('button', { name: 'Завершить игру' })).toBeDefined();
    expect(mutations()).toEqual([
      { method: 'POST', path: `/games/${GAME_ID}/reopen`, body: { expectedVersion: 9 } },
    ]);
  });

  it('offers the running game when another one is active', async () => {
    const other = game({ id: 'other0000001', name: 'Другая игра' });
    renderApp(
      `/games/${GAME_ID}`,
      routes({
        [`POST /games/${GAME_ID}/reopen`]: apiError(409, 'ACTIVE_GAME_EXISTS', {
          gameId: other.id,
        }),
        [`GET /games/${other.id}`]: { body: other },
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Меню' }));
    await userEvent.click(screen.getByRole('button', { name: 'Переоткрыть' }));
    expect(await screen.findByRole('heading', { name: 'Другая игра' })).toBeDefined();
    expect(confirmSpy).toHaveBeenLastCalledWith(expect.stringContaining('уже идёт'));
  });

  it('deletes the game and goes to the chat', async () => {
    const { mutations } = renderApp(
      `/games/${GAME_ID}`,
      routes({
        [`DELETE /games/${GAME_ID}`]: { status: 204 },
        'GET /chats/chat1': { body: CHAT },
        'GET /chats/chat1/games?status=active': { body: { items: [], nextCursor: null } },
        'GET /chats/chat1/games': { body: { items: [], nextCursor: null } },
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Меню' }));
    await userEvent.click(screen.getByRole('button', { name: 'Удалить игру' }));
    expect(await screen.findByRole('heading', { name: 'Покерный клуб' })).toBeDefined();
    expect(mutations()).toEqual([{ method: 'DELETE', path: `/games/${GAME_ID}`, body: undefined }]);
  });

  it('keeps the game when the deletion is not confirmed', async () => {
    confirmSpy.mockReturnValue(false);
    const { mutations } = renderApp(`/games/${GAME_ID}`, routes());
    await userEvent.click(await screen.findByRole('button', { name: 'Меню' }));
    await userEvent.click(screen.getByRole('button', { name: 'Удалить игру' }));
    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
    });
    expect(mutations()).toEqual([]);
  });
});

describe('finished game tabs', () => {
  it('shows parameters, players and the log', async () => {
    renderApp(`/games/${GAME_ID}?tab=details`, routes());
    expect(await screen.findByText('Вася Создатель')).toBeDefined();
    const panel = screen.getByRole('tabpanel');
    expect(plain(panel.textContent)).toContain('30 000 = 1 000 ₽');
    expect(plain(panel.textContent)).toContain('60 000 → 45 000');
    expect(panel.textContent).toContain('1 докуп');

    await userEvent.click(screen.getByRole('tab', { name: 'Журнал' }));
    expect(plain((await screen.findByRole('tabpanel')).textContent)).toContain(
      'Вася: выход с 45 000',
    );
  });
});
