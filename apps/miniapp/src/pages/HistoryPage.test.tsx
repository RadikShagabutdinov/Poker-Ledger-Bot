import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderApp } from '../test/testUtils';

const NOW = Date.UTC(2026, 9, 23, 12);
const DAY = 24 * 60 * 60 * 1000;

const item = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: `game${String(n).padStart(8, '0')}`,
  name: `Игра ${String(n)}`,
  type: 'cash',
  status: 'finished',
  startedAt: NOW - n * DAY,
  finishedAt: NOW - n * DAY + 3_600_000,
  playerCount: 3,
  issuedChips: 90_000,
  currency: 'RUB',
  stack: { chips: 30_000, amount: 1_000 },
  mismatchChips: null,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HistoryPage', () => {
  it('loads further pages by cursor', async () => {
    const first = Array.from({ length: 20 }, (_, i) => item(i + 1));
    const { calls } = renderApp('/chats/chat1/history', {
      'GET /chats/chat1/games': { body: { items: first, nextCursor: 'c1' } },
      'GET /chats/chat1/games?cursor=c1': {
        body: { items: [item(21, { mismatchChips: -500 })], nextCursor: null },
      },
    });
    expect(await screen.findAllByRole('button', { name: /^Игра \d+/ })).toHaveLength(20);
    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
    const last = await screen.findByRole('button', { name: /^Игра 21/ });
    expect(last.textContent).toContain('расхождение');
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
    expect(calls.map((c) => c.path)).toContain('/chats/chat1/games?cursor=c1');
  });

  it('filters by a rolling period', async () => {
    const from30 = NOW - 30 * DAY;
    const { calls } = renderApp('/chats/chat1/history', {
      'GET /chats/chat1/games': { body: { items: [item(1), item(100)], nextCursor: null } },
      [`GET /chats/chat1/games?from=${String(from30)}`]: {
        body: { items: [item(1)], nextCursor: null },
      },
    });
    expect(await screen.findAllByRole('button', { name: /^Игра/ })).toHaveLength(2);
    await userEvent.click(screen.getByRole('tab', { name: '30 дней' }));
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /^Игра/ })).toHaveLength(1);
    });
    expect(calls.at(-1)?.path).toBe(`/chats/chat1/games?from=${String(from30)}`);
    expect(screen.queryByRole('tab', { name: /Турнир/ })).toBeNull();
  });

  it('says when there are no games', async () => {
    renderApp('/chats/chat1/history', {
      'GET /chats/chat1/games': { body: { items: [], nextCursor: null } },
    });
    expect(await screen.findByText('За этот период игр нет.')).toBeDefined();
  });
});
