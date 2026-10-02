import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { apiError, game, logEntry, plain, renderApp } from '../../test/testUtils';

const GAME_ID = 'game00000001';
const entries = [
  logEntry(1, { type: 'game_created', playerId: null, playerName: null, chips: null }),
  logEntry(2, { type: 'player_added', chips: null }),
  logEntry(3),
  logEntry(4, { type: 'rebuy', cancelled: { by: 100, at: 1_757_900_400_000 } }),
  logEntry(5, { type: 'cash_out', chips: 52_000 }),
  logEntry(6, {
    type: 'settings_changed',
    playerId: null,
    playerName: null,
    chips: null,
    payload: {
      stack: { from: { chips: 30_000, amount: 1_000 }, to: { chips: 20_000, amount: 1_000 } },
    },
  }),
];

let confirmSpy: MockInstance<typeof window.confirm>;

beforeEach(() => {
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GameLogPage', () => {
  it('lists events newest first, cancelled ones struck through (V1-LOG-02)', async () => {
    renderApp(`/games/${GAME_ID}/log`, {
      [`GET /games/${GAME_ID}`]: { body: game() },
      [`GET /games/${GAME_ID}/log`]: { body: { entries } },
    });
    const titles = (await screen.findAllByText(/Вася|Игра|Стек/, { selector: '.item-title' })).map(
      (el) => plain(el.textContent),
    );
    expect(titles).toEqual([
      'Стек: 20 000 = 1 000 ₽',
      'Вася: выход с 52 000',
      'Вася: докуп 30 000',
      'Вася: вход 30 000',
      'Вася добавлен(а) в игру',
      'Игра создана',
    ]);
    const cancelled = screen.getByText('Вася: докуп 30 000', { exact: false }).closest('.item');
    expect(cancelled?.classList.contains('item-cancelled')).toBe(true);
    expect(cancelled?.textContent).toContain('отменено');
    // Only live chip events can be cancelled.
    expect(cancelled?.tagName).toBe('DIV');
  });

  it('names the event that has to be cancelled first (V1-LOG-04)', async () => {
    const { mutations } = renderApp(`/games/${GAME_ID}/log`, {
      [`GET /games/${GAME_ID}`]: { body: game() },
      [`GET /games/${GAME_ID}/log`]: { body: { entries } },
      [`POST /games/${GAME_ID}/events/3/cancel`]: apiError(422, 'INVALID_EVENT_SEQUENCE', {
        blockingEventId: 5,
      }),
    });
    await userEvent.click(await screen.findByRole('button', { name: /вход 30/ }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(mutations()).toEqual([
      { method: 'POST', path: `/games/${GAME_ID}/events/3/cancel`, body: {} },
    ]);
    expect(plain((await screen.findByRole('alert')).textContent)).toBe(
      'Сначала отмените: Вася: выход с 52 000',
    );
    expect(document.getElementById('log-entry-5')?.classList.contains('item-highlight')).toBe(true);
  });

  it('cancels an event', async () => {
    const { mutations } = renderApp(`/games/${GAME_ID}/log`, {
      [`GET /games/${GAME_ID}`]: { body: game() },
      [`GET /games/${GAME_ID}/log`]: { body: { entries } },
      [`POST /games/${GAME_ID}/events/5/cancel`]: {
        body: {
          game: game(),
          event: { eventId: 5, playerId: 'p1', type: 'cash_out', chips: 52_000 },
        },
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: /выход с 52/ }));
    expect(mutations()).toHaveLength(1);
    expect(plain((await screen.findByRole('status')).textContent)).toBe(
      'Отменено: Вася: выход с 52 000',
    );
  });
});
