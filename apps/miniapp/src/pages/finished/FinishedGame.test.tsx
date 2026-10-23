import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  apiError,
  game,
  plain,
  player,
  renderApp,
  settlement,
  type Routes,
} from '../../test/testUtils';

const GAME_ID = 'game00000001';

const finished = game({
  status: 'finished',
  version: 9,
  finishedAt: 1_757_910_000_000,
  summary: {
    issuedChips: 135_000,
    cashedOutChips: 135_000,
    expectedOnTableChips: 0,
    seatedCount: 0,
  },
  players: [
    player('p1', 'Вася', {
      status: 'left',
      inChips: 60_000,
      outChips: 12_000,
      rebuyCount: 1,
      moneyResult: -1_600,
    }),
    player('p2', 'Петя', { seatOrder: 2, status: 'left', outChips: 71_000, moneyResult: 1_367 }),
    player('p3', 'Коля', {
      seatOrder: 3,
      status: 'left',
      inChips: 45_000,
      outChips: 52_000,
      moneyResult: 233,
    }),
  ],
  myPlayerId: 'p2',
  permissions: { canManage: true, canEditFinished: false, canEditSettlement: true },
});

const autoTransfers = [
  { from: 'p1', to: 'p2', amount: 1_367 },
  { from: 'p1', to: 'p3', amount: 233 },
];

function routes(overrides: Routes = {}, state = finished): Routes {
  return {
    [`GET /games/${GAME_ID}`]: { body: state },
    [`GET /games/${GAME_ID}/settlement`]: {
      body: settlement({ version: state.version, transfers: autoTransfers }),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('finished game', () => {
  it('opens on the results, best first', async () => {
    renderApp(`/games/${GAME_ID}`, routes());
    expect(await screen.findByRole('tab', { name: 'Итоги', selected: true })).toBeDefined();
    const panel = screen.getByRole('tabpanel');
    const text = plain(panel.textContent);
    expect(text.indexOf('Петя')).toBeLessThan(text.indexOf('Коля'));
    expect(text.indexOf('Коля')).toBeLessThan(text.indexOf('Вася'));
    expect(text).toContain('куплено 60 000 · вынес 12 000 · итог −48 000');
    expect(text).toContain('+1 367 ₽');
    expect(text).toContain('−1 600 ₽');
    expect(screen.queryByText(/На столе/)).toBeNull();
  });

  it('shows the mismatch and how it was adjusted', async () => {
    renderApp(
      `/games/${GAME_ID}`,
      routes(
        {},
        game({
          ...finished,
          mismatch: { mode: 'single_player', playerId: 'p3', chips: -1_000 },
          players: finished.players.map((p) =>
            p.playerId === 'p3' ? { ...p, outChips: 51_000, moneyResult: 200 } : p,
          ),
        }),
      ),
    );
    const notice = (await screen.findByText(/На столе/)).closest('.notice') as HTMLElement;
    expect(plain(notice.textContent)).toContain('На столе на 1 000 фишек (≈33 ₽) меньше');
    expect(notice.textContent).toContain('Разница отнесена на игрока Коля.');
    // Коля: 51 000 − 45 000 + 1 000 adjustment.
    expect(plain(screen.getByRole('tabpanel').textContent)).toContain(
      'куплено 45 000 · вынес 51 000 · итог +7 000',
    );
  });

  it('lists transfers, highlights mine and shows payment details only when present', async () => {
    renderApp(
      `/games/${GAME_ID}?tab=settlement`,
      routes({
        [`GET /games/${GAME_ID}/settlement`]: {
          body: settlement({
            version: 9,
            transfers: [
              {
                ...autoTransfers[0]!,
                recipientPayment: { phone: '+79991112233', bank: 'Сбер', note: null },
              },
              autoTransfers[1]!,
            ],
          }),
        },
      }),
    );
    const mine = await screen.findByText('Вася → Петя');
    const mineRow = mine.closest('.transfer') as HTMLElement;
    expect(mineRow.className).toContain('transfer-mine');
    expect(within(mineRow).getByText('+79991112233')).toBeDefined();
    expect(within(mineRow).getByText('Сбер')).toBeDefined();

    const other = screen.getByText('Вася → Коля').closest('.transfer') as HTMLElement;
    expect(other.className).not.toContain('transfer-mine');
    expect(within(other).queryByRole('button', { name: /Скопировать/ })).toBeNull();

    const user = userEvent.setup();
    await user.click(within(mineRow).getByRole('button', { name: 'Скопировать: +79991112233' }));
    expect(await navigator.clipboard.readText()).toBe('+79991112233');
    expect(await screen.findByText('Скопировано')).toBeDefined();
  });

  it('shows no payment details when the server sends none', async () => {
    renderApp(`/games/${GAME_ID}?tab=settlement`, routes());
    await screen.findByText('Вася → Петя');
    expect(screen.queryByRole('button', { name: /Скопировать/ })).toBeNull();
    expect(screen.queryByText('Телефон')).toBeNull();
  });

  it('hides editing without the permission', async () => {
    renderApp(
      `/games/${GAME_ID}?tab=settlement`,
      routes(
        {},
        game({
          ...finished,
          permissions: { canManage: true, canEditFinished: false, canEditSettlement: false },
        }),
      ),
    );
    await screen.findByText('Вася → Петя');
    expect(screen.queryByRole('button', { name: 'Изменить переводы' })).toBeNull();
  });

  it('warns about unbalanced edits but still saves them', async () => {
    const saved = settlement({
      version: 10,
      isManual: true,
      transfers: [
        { from: 'p1', to: 'p2', amount: 1_000 },
        { from: 'p1', to: 'p3', amount: 233 },
      ],
      warnings: [
        { code: 'BALANCE_MISMATCH', playerId: 'p1', delta: 367 },
        { code: 'BALANCE_MISMATCH', playerId: 'p2', delta: -367 },
      ],
    });
    const { mutations } = renderApp(
      `/games/${GAME_ID}?tab=settlement`,
      routes({ [`PUT /games/${GAME_ID}/settlement`]: { body: saved } }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Изменить переводы' }));

    const first = screen.getByRole('region', { name: 'Вася → Петя' });
    const amount = within(first).getByRole('textbox', { name: 'Сумма, RUB' });
    await userEvent.clear(amount);
    await userEvent.type(amount, '1000');

    const warnings = screen.getByRole('alert');
    expect(warnings.textContent).toContain('Переводы не совпадают с итогами');
    expect(plain(warnings.textContent)).toContain(
      'Вася: по переводам −1 233 ₽, по итогам −1 600 ₽',
    );
    expect(plain(warnings.textContent)).toContain(
      'Петя: по переводам +1 000 ₽, по итогам +1 367 ₽',
    );

    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect(save).toHaveProperty('disabled', false);
    await userEvent.click(save);
    await waitFor(() => {
      expect(mutations()).toHaveLength(1);
    });
    expect(mutations()[0]).toMatchObject({
      method: 'PUT',
      body: {
        transfers: [
          { from: 'p1', to: 'p2', amount: 1_000 },
          { from: 'p1', to: 'p3', amount: 233 },
        ],
        expectedVersion: 9,
      },
    });
    expect(await screen.findByText('Сохранено, но переводы не совпадают с итогами')).toBeDefined();
  });

  it('blocks saving self-transfers and empty amounts', async () => {
    renderApp(`/games/${GAME_ID}?tab=settlement`, routes());
    await userEvent.click(await screen.findByRole('button', { name: 'Изменить переводы' }));
    await userEvent.click(screen.getByRole('button', { name: '+ Перевод' }));
    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect(save).toHaveProperty('disabled', true);
    expect(screen.getByText('Сумма должна быть больше нуля')).toBeDefined();

    const added = screen.getAllByRole('region').at(-1) as HTMLElement;
    await userEvent.type(within(added).getByRole('textbox'), '100');
    expect(save).toHaveProperty('disabled', false);
    await userEvent.selectOptions(within(added).getByRole('combobox', { name: 'Кому' }), 'Вася');
    expect(within(added).getByText('Плательщик и получатель совпадают')).toBeDefined();
    expect(save).toHaveProperty('disabled', true);

    await userEvent.click(within(added).getByRole('button', { name: 'Удалить перевод' }));
    expect(save).toHaveProperty('disabled', false);
  });

  it('restores the automatic transfers', async () => {
    const { mutations } = renderApp(
      `/games/${GAME_ID}?tab=settlement`,
      routes({
        [`POST /games/${GAME_ID}/settlement/reset`]: {
          body: settlement({ version: 10, transfers: autoTransfers }),
        },
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Изменить переводы' }));
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть автоматическую схему' }));
    await waitFor(() => {
      expect(mutations()).toEqual([
        {
          method: 'POST',
          path: `/games/${GAME_ID}/settlement/reset`,
          body: { expectedVersion: 9 },
        },
      ]);
    });
    expect(await screen.findByText('Схема переводов пересчитана автоматически')).toBeDefined();
  });

  it('keeps the draft on a version conflict', async () => {
    renderApp(
      `/games/${GAME_ID}?tab=settlement`,
      routes({ [`PUT /games/${GAME_ID}/settlement`]: apiError(409, 'CONFLICT') }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Изменить переводы' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Данные изменились, проверьте ещё раз.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDefined();
  });
});
