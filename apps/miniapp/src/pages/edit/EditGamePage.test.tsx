import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  apiError,
  game,
  logEntry,
  player,
  renderApp,
  type Call,
  type Routes,
} from '../../test/testUtils';

const GAME_ID = 'game00000001';
const EDIT = `POST /games/${GAME_ID}/edit`;

const finished = game({
  status: 'finished',
  version: 9,
  finishedAt: 1_757_910_000_000,
  settlementIsManual: true,
  players: [
    player('p1', 'Вася', {
      status: 'left',
      inChips: 60_000,
      outChips: 12_000,
      rebuyCount: 1,
      moneyResult: -1_600,
    }),
    player('p2', 'Петя', { seatOrder: 2, status: 'left', outChips: 78_000, moneyResult: 1_600 }),
  ],
  permissions: { canManage: true, canEditFinished: true, canEditSettlement: true },
});

const log = {
  entries: [
    logEntry(1, { type: 'buy_in', chips: 30_000 }),
    logEntry(2, { type: 'buy_in', playerId: 'p2', playerName: 'Петя' }),
    logEntry(3, { type: 'rebuy', chips: 30_000 }),
    logEntry(4, { type: 'cash_out', chips: 12_000 }),
    logEntry(5, { type: 'cash_out', playerId: 'p2', playerName: 'Петя', chips: 78_000 }),
  ],
};

function routes(overrides: Routes = {}, state = finished): Routes {
  return {
    [`GET /games/${GAME_ID}`]: { body: state },
    [`GET /games/${GAME_ID}/log`]: { body: log },
    [`GET /games/${GAME_ID}/settlement`]: {
      body: { version: 9, isManual: true, transfers: [], warnings: [] },
    },
    [EDIT]: { body: { game: game({ ...state, version: 10 }) } },
    ...overrides,
  };
}

async function openPlayer(name: string) {
  return screen.findByRole('heading', { name }).then((h) => h.closest('section') as HTMLElement);
}

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('editing a finished game', () => {
  it('sends an ordinary chat member back to the results', async () => {
    const member = game({
      ...finished,
      permissions: { canManage: true, canEditFinished: false, canEditSettlement: false },
    });
    renderApp(`/games/${GAME_ID}/edit`, routes({}, member));
    expect(await screen.findByRole('tab', { name: 'Итоги' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Редактирование' })).toBeNull();
  });

  it('corrects the chips of an event in place', async () => {
    const { mutations } = renderApp(`/games/${GAME_ID}/edit`, routes());
    const vasya = await openPlayer('Вася');
    await userEvent.click(within(vasya).getByRole('button', { name: /Выход с 12/ }));
    const sheet = screen.getByRole('dialog');
    const field = within(sheet).getByLabelText('Фишек');
    await userEvent.clear(field);
    await userEvent.type(field, '13000');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(mutations()).toEqual([
        {
          method: 'POST',
          path: `/games/${GAME_ID}/edit`,
          body: { replace: [{ eventId: 4, chips: 13_000 }], expectedVersion: 9 },
        },
      ]);
    });
    expect(await screen.findByText('Изменения сохранены')).toBeDefined();
  });

  it('asks what to do with manual transfers when results change', async () => {
    const answers: Call[] = [];
    const { mutations } = renderApp(
      `/games/${GAME_ID}/edit`,
      routes({
        [EDIT]: (call) => {
          answers.push(call);
          return answers.length === 1
            ? apiError(422, 'VALIDATION', { reason: 'SETTLEMENT_POLICY_REQUIRED' })
            : { body: { game: game({ ...finished, version: 10 }) } };
        },
      }),
    );
    const vasya = await openPlayer('Вася');
    await userEvent.click(within(vasya).getByRole('button', { name: /Докуп 30/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Отменить докуп' }));
    const choice = await screen.findByRole('dialog', { name: 'Переводы правились вручную' });
    await userEvent.click(within(choice).getByRole('button', { name: /Оставить ручную/ }));
    await waitFor(() => {
      expect(mutations().map((c) => c.body)).toEqual([
        { cancel: [3], expectedVersion: 9 },
        { cancel: [3], expectedVersion: 9, settlementPolicy: 'keep' },
      ]);
    });
  });

  it('adds a rebuy before the last cash-out', async () => {
    const { mutations } = renderApp(`/games/${GAME_ID}/edit`, routes());
    const petya = await openPlayer('Петя');
    await userEvent.click(within(petya).getByRole('button', { name: '+ Докуп' }));
    const sheet = screen.getByRole('dialog', { name: 'Докуп: Петя' });
    const final = within(sheet).getByLabelText('Фишек на выходе');
    await userEvent.clear(final);
    await userEvent.type(final, '90000');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(mutations()[0]?.body).toEqual({
        cancel: [5],
        add: [
          { playerId: 'p2', type: 'rebuy', chips: 30_000 },
          { playerId: 'p2', type: 'cash_out', chips: 90_000 },
        ],
        expectedVersion: 9,
      });
    });
  });

  it('removes a whole entry and renames the game', async () => {
    const { mutations } = renderApp(
      `/games/${GAME_ID}/edit`,
      routes({ [`PATCH /games/${GAME_ID}`]: { body: { game: finished } } }),
    );
    const petya = await openPlayer('Петя');
    await userEvent.click(within(petya).getByRole('button', { name: 'Удалить вход целиком' }));
    await waitFor(() => {
      expect(mutations()[0]?.body).toEqual({ cancel: [2, 5], expectedVersion: 9 });
    });

    await userEvent.click(screen.getByRole('button', { name: /Название/ }));
    const sheet = screen.getByRole('dialog', { name: 'Название игры' });
    const name = within(sheet).getByLabelText('Название');
    await userEvent.clear(name);
    await userEvent.type(name, 'Финал');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(mutations()[1]).toEqual({
        method: 'PATCH',
        path: `/games/${GAME_ID}`,
        body: { name: 'Финал', expectedVersion: 10 },
      });
    });
  });
});
