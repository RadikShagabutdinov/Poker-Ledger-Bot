import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { GAME_POLL_MS, queryKeys } from '../../api/queries';
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
const base = (state = game()): Routes => ({
  [`GET /games/${GAME_ID}`]: { body: state },
  [`GET /games/${GAME_ID}/log`]: { body: { entries: [] } },
  'GET /chats/chat1': { body: CHAT },
  'GET /chats/chat1/players': {
    body: {
      players: [
        { playerId: 'p1', name: 'Вася', isGuest: false },
        { playerId: 'p2', name: 'Петя', isGuest: false },
        { playerId: 'p5', name: 'Коля', isGuest: true },
      ],
    },
  },
});

async function openPlayer(name: string) {
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
  return screen.getByRole('dialog', { name });
}

let confirmSpy: MockInstance<typeof window.confirm>;

beforeEach(() => {
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GamePage', () => {
  it('shows the summary and players grouped by status', async () => {
    renderApp(`/games/${GAME_ID}`, {
      ...base(
        game({
          summary: {
            issuedChips: 120_000,
            cashedOutChips: 52_000,
            expectedOnTableChips: 68_000,
            seatedCount: 1,
          },
          players: [
            player('p1', 'Вася', { inChips: 60_000, rebuyCount: 1 }),
            player('p2', 'Петя', {
              status: 'left',
              inChips: 60_000,
              outChips: 52_000,
              buyinCount: 2,
              moneyResult: -267,
            }),
            player('p3', 'Дима', { status: 'not_joined', inChips: 0, buyinCount: 0 }),
          ],
        }),
      ),
    });
    expect(await screen.findByRole('heading', { name: 'Покер 15.09' })).toBeDefined();
    expect(plain(screen.getByText(/120 000 ·/).textContent)).toBe('120 000 · 4 000 ₽');
    expect(screen.getByText('За столом')).toBeDefined();
    expect(screen.getByText('Ожидают входа')).toBeDefined();
    expect(screen.getByText('Вышли')).toBeDefined();
    const petya = screen.getByRole('button', { name: /Петя/ });
    expect(plain(petya.textContent)).toContain('куплено 60 000 · 2 входа · вынес 52 000');
    expect(plain(petya.textContent)).toContain('−267 ₽');
    expect(plain(screen.getByRole('button', { name: /Вася/ }).textContent)).toContain(
      '1 вход · 1 докуп',
    );
  });

  it('polls the game every 3 seconds', async () => {
    const { queryClient } = renderApp(`/games/${GAME_ID}`, base());
    await screen.findByRole('heading', { name: 'Покер 15.09' });
    const observer = queryClient.getQueryCache().find({ queryKey: queryKeys.game(GAME_ID) })
      ?.observers[0];
    expect(observer?.options.refetchInterval).toBe(GAME_POLL_MS);
    expect(observer?.options.refetchIntervalInBackground).toBe(false);
  });

  it('buys a stack with a quick button', async () => {
    const after = game({
      players: [player('p1', 'Вася', { inChips: 60_000, rebuyCount: 1 })],
    });
    const { mutations } = renderApp(`/games/${GAME_ID}`, {
      ...base(),
      [`POST /games/${GAME_ID}/events`]: {
        body: {
          game: after,
          event: { eventId: 3, playerId: 'p1', type: 'rebuy', chips: 30_000 },
        },
      },
    });
    const sheet = await openPlayer('Вася');
    await userEvent.click(within(sheet).getByRole('button', { name: /1 стек/ }));
    expect(mutations()).toEqual([
      {
        method: 'POST',
        path: `/games/${GAME_ID}/events`,
        body: { type: 'buy', playerId: 'p1', chips: 30_000 },
      },
    ]);
    expect(plain((await screen.findByRole('status')).textContent)).toBe('Докуп 30 000 записан');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('buys a custom number of chips and shows the money equivalent', async () => {
    const { mutations } = renderApp(`/games/${GAME_ID}`, {
      ...base(),
      [`POST /games/${GAME_ID}/events`]: {
        body: {
          game: game(),
          event: { eventId: 3, playerId: 'p1', type: 'rebuy', chips: 12_345 },
        },
      },
    });
    const sheet = await openPlayer('Вася');
    await userEvent.type(within(sheet).getByLabelText('Своё количество'), '12345');
    expect(plain(within(sheet).getByText(/≈/).textContent)).toBe('≈ 412 ₽');
    await userEvent.click(within(sheet).getByRole('button', { name: /Купить 12/ }));
    expect(mutations()[0]?.body).toEqual({ type: 'buy', playerId: 'p1', chips: 12_345 });
  });

  it('rejects fractional input in the chips field', async () => {
    renderApp(`/games/${GAME_ID}`, base());
    const sheet = await openPlayer('Вася');
    await userEvent.type(within(sheet).getByLabelText('Своё количество'), '1,5');
    expect(within(sheet).getByRole('alert').textContent).toBe('Только целое число');
    expect(
      within(sheet)
        .getByRole('button', { name: /Купить/ })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('cashes out with a preliminary result', async () => {
    const { mutations } = renderApp(`/games/${GAME_ID}`, {
      ...base(game({ players: [player('p1', 'Вася', { inChips: 60_000, rebuyCount: 1 })] })),
      [`POST /games/${GAME_ID}/events`]: {
        body: {
          game: game(),
          event: { eventId: 4, playerId: 'p1', type: 'cash_out', chips: 52_000 },
        },
      },
    });
    const sheet = await openPlayer('Вася');
    await userEvent.type(within(sheet).getByLabelText('Фишек на руках'), '52000');
    expect(plain(within(sheet).getByText(/Предварительный итог/).textContent)).toBe(
      'Предварительный итог: −267 ₽',
    );
    await userEvent.click(within(sheet).getByRole('button', { name: 'Выйти' }));
    expect(mutations()[0]?.body).toEqual({ type: 'cash_out', playerId: 'p1', chips: 52_000 });
    expect(plain((await screen.findByRole('status')).textContent)).toBe('Выход записан: 52 000');
  });

  it('adds a guest and opens their buy-in panel', async () => {
    const withGuest = game({
      players: [
        player('p1', 'Вася'),
        player('p9', 'Лёша', { isGuest: true, status: 'not_joined', inChips: 0, buyinCount: 0 }),
      ],
    });
    const { mutations } = renderApp(`/games/${GAME_ID}`, {
      ...base(),
      [`POST /games/${GAME_ID}/players`]: {
        body: { game: withGuest, playerId: 'p9', added: true },
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: '+ Игрок' }));
    const sheet = screen.getByRole('dialog', { name: 'Добавить игрока' });
    expect(within(sheet).getByText(/Telegram не даёт боту список участников/)).toBeDefined();
    // Known players not in the game are offered; the current user is already in it.
    expect(within(sheet).getByRole('button', { name: /Петя/ })).toBeDefined();
    expect(within(sheet).queryByRole('button', { name: 'Добавить себя' })).toBeNull();

    await userEvent.type(within(sheet).getByLabelText('Имя гостя'), 'Лёша');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Добавить' }));
    expect(mutations()[0]?.body).toEqual({ guestName: 'Лёша' });
    expect(await screen.findByRole('dialog', { name: 'Лёша' })).toBeDefined();
  });

  it('suggests an existing guest with the same name', async () => {
    const { mutations } = renderApp(`/games/${GAME_ID}`, {
      ...base(),
      [`POST /games/${GAME_ID}/players`]: {
        body: { game: game(), playerId: 'p5', added: true },
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: '+ Игрок' }));
    const sheet = screen.getByRole('dialog', { name: 'Добавить игрока' });
    await userEvent.type(within(sheet).getByLabelText('Имя гостя'), 'коля');
    expect(within(sheet).getByText('Гость «Коля» уже есть в чате.')).toBeDefined();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Добавить его' }));
    expect(mutations()[0]?.body).toEqual({ playerId: 'p5' });
  });

  it('offers the existing guest when the server reports GUEST_NAME_TAKEN', async () => {
    const { mutations } = renderApp(`/games/${GAME_ID}`, {
      ...base(),
      'GET /chats/chat1/players': { body: { players: [] } },
      [`POST /games/${GAME_ID}/players`]: (call) =>
        'guestName' in (call.body as object)
          ? apiError(409, 'GUEST_NAME_TAKEN', { playerId: 'p5' })
          : { body: { game: game(), playerId: 'p5', added: true } },
    });
    await userEvent.click(await screen.findByRole('button', { name: '+ Игрок' }));
    const sheet = screen.getByRole('dialog', { name: 'Добавить игрока' });
    await userEvent.type(within(sheet).getByLabelText('Имя гостя'), 'Коля');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Добавить' }));
    await waitFor(() => {
      expect(mutations()).toHaveLength(2);
    });
    expect(confirmSpy).toHaveBeenCalledWith('Гость «Коля» уже есть в чате. Добавить его в игру?');
    expect(mutations()[1]?.body).toEqual({ playerId: 'p5' });
  });

  it("undoes the player's own last live chip event", async () => {
    const { mutations } = renderApp(`/games/${GAME_ID}`, {
      ...base(),
      [`GET /games/${GAME_ID}/log`]: {
        body: {
          entries: [
            logEntry(3),
            logEntry(4, { type: 'rebuy' }),
            logEntry(5, { playerId: 'p2', playerName: 'Петя' }),
            logEntry(6, { type: 'rebuy', cancelled: { by: 100, at: 1_757_900_500_000 } }),
          ],
        },
      },
      [`POST /games/${GAME_ID}/events/4/cancel`]: {
        body: { game: game(), event: { eventId: 4, playerId: 'p1', type: 'rebuy', chips: 30_000 } },
      },
    });
    const sheet = await openPlayer('Вася');
    const undo = within(sheet).getByRole('button', { name: 'Отменить последнее действие игрока' });
    await waitFor(() => {
      expect(undo.hasAttribute('disabled')).toBe(false);
    });
    await userEvent.click(undo);
    expect(plain(confirmSpy.mock.calls[0]?.[0])).toBe('Отменить «Вася: докуп 30 000»?');
    expect(mutations()).toEqual([
      { method: 'POST', path: `/games/${GAME_ID}/events/4/cancel`, body: {} },
    ]);
  });

  it('undoes the last action after confirmation', async () => {
    const { mutations } = renderApp(`/games/${GAME_ID}`, {
      ...base(),
      [`POST /games/${GAME_ID}/undo`]: {
        body: {
          game: game(),
          event: { eventId: 3, playerId: 'p1', type: 'rebuy', chips: 30_000 },
        },
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: /Отменить последнее/ }));
    expect(mutations()).toEqual([{ method: 'POST', path: `/games/${GAME_ID}/undo`, body: {} }]);
    expect(plain((await screen.findByRole('status')).textContent)).toBe(
      'Отменено: Вася: докуп 30 000',
    );
  });

  it('does nothing when the undo is not confirmed', async () => {
    confirmSpy.mockReturnValue(false);
    const { mutations } = renderApp(`/games/${GAME_ID}`, base());
    await userEvent.click(await screen.findByRole('button', { name: /Отменить последнее/ }));
    expect(mutations()).toEqual([]);
  });

  it('shows a translated error code', async () => {
    renderApp(`/games/${GAME_ID}`, {
      ...base(),
      [`POST /games/${GAME_ID}/undo`]: apiError(409, 'NOTHING_TO_UNDO'),
    });
    await userEvent.click(await screen.findByRole('button', { name: /Отменить последнее/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Нечего отменять.');
  });

  it('opens the finish screen from the main button', async () => {
    renderApp(`/games/${GAME_ID}`, base());
    await userEvent.click(await screen.findByRole('button', { name: 'Завершить игру' }));
    expect(await screen.findByText('Этот экран появится в следующей версии.')).toBeDefined();
  });

  it('hides actions without the manage permission', async () => {
    renderApp(
      `/games/${GAME_ID}`,
      base(
        game({
          permissions: { canManage: false, canEditFinished: false, canEditSettlement: false },
        }),
      ),
    );
    expect(await screen.findByText('Только просмотр.')).toBeDefined();
    expect(screen.queryByRole('button', { name: '+ Игрок' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Завершить игру' })).toBeNull();
  });
});
