import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  apiError,
  finishPreview,
  game,
  plain,
  player,
  renderApp,
  settlement,
  type Call,
  type Routes,
} from '../../test/testUtils';

const GAME_ID = 'game00000001';

// Вася and Петя are seated with 30 000 each, Коля left with 20 000 of 30 000 bought.
const active = game({
  version: 7,
  summary: {
    issuedChips: 90_000,
    cashedOutChips: 20_000,
    expectedOnTableChips: 70_000,
    seatedCount: 2,
  },
  players: [
    player('p1', 'Вася'),
    player('p2', 'Петя', { seatOrder: 2 }),
    player('p3', 'Коля', { seatOrder: 3, status: 'left', outChips: 20_000, moneyResult: -333 }),
  ],
});

const finished = game({
  ...active,
  status: 'finished',
  version: 8,
  finishedAt: 1_757_910_000_000,
  players: active.players.map((p) => ({ ...p, status: 'left' as const, moneyResult: 0 })),
});

function routes(overrides: Routes = {}): Routes {
  return {
    [`GET /games/${GAME_ID}`]: { body: active },
    [`POST /games/${GAME_ID}/finish/preview`]: { body: finishPreview() },
    ...overrides,
  };
}

// The label also holds the money hint once a value is typed.
const field = (name: string) => screen.findByRole('textbox', { name: new RegExp(`^${name}`) });
const finishButton = () => screen.getByRole('button', { name: 'Завершить' });
const reconcile = () => screen.getByTestId('reconcile');

describe('FinishGamePage', () => {
  it('blocks finishing until all seated players have chips, then previews', async () => {
    const { calls } = renderApp(`/games/${GAME_ID}/finish`, routes());
    await userEvent.type(await field('Вася'), '45000');
    expect(finishButton()).toHaveProperty('disabled', true);
    expect(plain(reconcile().textContent)).toContain('65 000, посчитаны не все');
    expect(screen.getByText(/Итоги появятся/)).toBeDefined();
    expect(calls.some((c) => c.path.endsWith('/finish/preview'))).toBe(false);

    await userEvent.type(await field('Петя'), '25000');
    expect(finishButton()).toHaveProperty('disabled', false);
    expect(await screen.findByText('Предпросмотр итогов')).toBeDefined();
    const previews = calls.filter((c) => c.path.endsWith('/finish/preview'));
    expect(previews.at(-1)?.body).toEqual({
      finalChips: { p1: 45_000, p2: 25_000 },
      mismatchMode: 'proportional',
    });
    expect(screen.getByText('Петя → Вася')).toBeDefined();
  });

  it('shows matching chips without an adjustment choice', async () => {
    renderApp(`/games/${GAME_ID}/finish`, routes());
    await userEvent.type(await field('Вася'), '45000');
    await userEvent.type(await field('Петя'), '25000');
    expect(reconcile().className).toContain('reconcile-ok');
    expect(within(reconcile()).getByText('Фишки сходятся.')).toBeDefined();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('shows the mismatch and sends the chosen adjustment', async () => {
    const { mutations } = renderApp(
      `/games/${GAME_ID}/finish`,
      routes({
        [`POST /games/${GAME_ID}/finish`]: {
          body: { game: finished, result: finishPreview({ mismatchChips: -1_000 }) },
        },
        [`GET /games/${GAME_ID}/settlement`]: { body: settlement({ version: 8 }) },
      }),
    );
    await userEvent.type(await field('Вася'), '45000');
    await userEvent.type(await field('Петя'), '24000');
    expect(reconcile().className).toContain('reconcile-bad');
    expect(plain(within(reconcile()).getByText(/−1 000/).textContent)).toBe('−1 000 · −33 ₽');
    expect(plain(screen.getByRole('status').textContent)).toContain(
      'На столе на 1 000 фишек (≈33 ₽) меньше, чем выдано.',
    );

    await userEvent.click(screen.getByRole('radio', { name: 'Отнести на одного игрока' }));
    // Not finishable until the player is chosen.
    expect(finishButton()).toHaveProperty('disabled', true);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Игрок' }), 'Коля');
    await userEvent.click(finishButton());

    await waitFor(() => {
      expect(mutations().some((c) => c.path === `/games/${GAME_ID}/finish`)).toBe(true);
    });
    expect(mutations().find((c) => c.path === `/games/${GAME_ID}/finish`)?.body).toEqual({
      finalChips: { p1: 45_000, p2: 24_000 },
      mismatchMode: 'single_player',
      mismatchPlayerId: 'p3',
      expectedVersion: 7,
    });
    // The finished game opens its results.
    expect(await screen.findByRole('tab', { name: 'Итоги' })).toBeDefined();
  });

  it('reloads the game and warns on a version conflict', async () => {
    let gameReads = 0;
    const { calls } = renderApp(
      `/games/${GAME_ID}/finish`,
      routes({
        [`GET /games/${GAME_ID}`]: () => {
          gameReads += 1;
          return { body: active };
        },
        [`POST /games/${GAME_ID}/finish`]: apiError(409, 'CONFLICT', { version: 8 }),
      }),
    );
    await userEvent.type(await field('Вася'), '45000');
    await userEvent.type(await field('Петя'), '25000');
    const readsBefore = gameReads;
    await userEvent.click(finishButton());
    expect(await screen.findByText('Данные изменились, проверьте ещё раз.')).toBeDefined();
    await waitFor(() => {
      expect(gameReads).toBeGreaterThan(readsBefore);
    });
    // What was typed stays.
    expect(plain(screen.getAllByRole('textbox')[0]?.getAttribute('value'))).toBe('45 000');
    expect(calls.filter((c: Call) => c.path === `/games/${GAME_ID}/finish`)).toHaveLength(1);
  });

  it('offers no finishing for a game without purchases', async () => {
    renderApp(
      `/games/${GAME_ID}/finish`,
      routes({
        [`GET /games/${GAME_ID}`]: {
          body: game({
            summary: { issuedChips: 0, cashedOutChips: 0, expectedOnTableChips: 0, seatedCount: 0 },
            players: [player('p1', 'Вася', { status: 'not_joined', inChips: 0, buyinCount: 0 })],
          }),
        },
      }),
    );
    expect(await screen.findByText(/можно только удалить/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Завершить' })).toBeNull();
  });
});
