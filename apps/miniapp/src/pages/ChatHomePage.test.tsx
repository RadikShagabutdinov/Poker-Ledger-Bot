import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CHAT, plain, renderApp } from '../test/testUtils';

const item = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Игра ${id}`,
  type: 'cash',
  status: 'finished',
  startedAt: 1_757_900_000_000,
  finishedAt: 1_757_910_000_000,
  playerCount: 4,
  issuedChips: 150_000,
  currency: 'RUB',
  stack: { chips: 30_000, amount: 1_000 },
  mismatchChips: null,
  ...overrides,
});

describe('ChatHomePage', () => {
  it('shows the active game and the last five games (§12.3)', async () => {
    const games = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => item(`game0000000${id}`));
    games[1] = item('game0000000b', { mismatchChips: 1_000 });
    renderApp('/chats/chat1', {
      'GET /chats/chat1': { body: CHAT },
      'GET /chats/chat1/games?status=active': {
        body: {
          items: [item('active000001', { status: 'active', name: 'Сейчас' })],
          nextCursor: null,
        },
      },
      'GET /chats/chat1/games': { body: { items: games, nextCursor: 'next' } },
    });
    expect(await screen.findByRole('heading', { name: 'Покерный клуб' })).toBeDefined();
    expect(await screen.findByRole('button', { name: /Сейчас/ })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Новая игра' })).toBeNull();
    expect(await screen.findAllByRole('button', { name: /^Игра game/ })).toHaveLength(5);
    const withMismatch = screen.getByRole('button', { name: /Игра game0000000b/ });
    expect(plain(withMismatch.textContent)).toContain('5 000 ₽');
    expect(withMismatch.textContent).toContain('расхождение');
    expect(screen.getByRole('link', { name: 'Вся история' })).toBeDefined();
    expect(screen.queryByText(/Статистика/)).toBeNull();
  });

  it('offers a new game when none is running', async () => {
    renderApp('/chats/chat1', {
      'GET /chats/chat1': { body: CHAT },
      'GET /chats/chat1/games?status=active': { body: { items: [], nextCursor: null } },
      'GET /chats/chat1/games': { body: { items: [], nextCursor: null } },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Новая игра' }));
    expect(await screen.findByRole('heading', { name: 'Новая игра' })).toBeDefined();
  });

  it('reports a user outside the chat', async () => {
    renderApp('/chats/chat1', {
      'GET /chats/chat1': { status: 403, body: { error: { code: 'NOT_CHAT_MEMBER' } } },
      'GET /chats/chat1/games?status=active': {
        status: 403,
        body: { error: { code: 'NOT_CHAT_MEMBER' } },
      },
      'GET /chats/chat1/games': { status: 403, body: { error: { code: 'NOT_CHAT_MEMBER' } } },
    });
    expect((await screen.findAllByText('Вы не участник этого чата.')).length).toBeGreaterThan(0);
  });
});
