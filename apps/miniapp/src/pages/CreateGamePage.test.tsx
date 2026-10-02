import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { apiError, CHAT, game, plain, renderApp } from '../test/testUtils';

describe('CreateGamePage', () => {
  it('prefills the form from the chat settings and creates the game (V1-GAME-02)', async () => {
    const { mutations } = renderApp('/chats/chat1/new', {
      'GET /chats/chat1': { body: CHAT },
      'POST /chats/chat1/games': { status: 201, body: { game: game({ name: 'Пятница' }) } },
      'GET /games/game00000001': { body: game({ name: 'Пятница' }) },
      'GET /games/game00000001/log': { body: { entries: [] } },
    });
    const name = await screen.findByLabelText<HTMLInputElement>('Название');
    expect(name.value).toBe('Покер 15.09');
    expect(plain(screen.getByText(/1 фишка/).textContent)).toBe('1 фишка ≈ 0,033 ₽');

    await userEvent.clear(name);
    await userEvent.type(name, 'Пятница');
    const chips = screen.getByLabelText('Фишек в стеке');
    await userEvent.clear(chips);
    await userEvent.type(chips, '20000');
    await userEvent.click(screen.getByRole('button', { name: 'Начать игру' }));

    expect(mutations()[0]?.body).toEqual({
      name: 'Пятница',
      stackChips: 20_000,
      stackAmount: 1_000,
    });
    expect(await screen.findByRole('heading', { name: 'Пятница' })).toBeDefined();
  });

  it('blocks the start without a valid stack', async () => {
    renderApp('/chats/chat1/new', { 'GET /chats/chat1': { body: CHAT } });
    const amount = await screen.findByLabelText('Стоит, RUB');
    await userEvent.clear(amount);
    expect(screen.getByRole('button', { name: 'Начать игру' }).hasAttribute('disabled')).toBe(true);
  });

  it('opens the running game on ACTIVE_GAME_EXISTS (V1-GAME-03)', async () => {
    renderApp('/chats/chat1/new', {
      'GET /chats/chat1': { body: CHAT },
      'POST /chats/chat1/games': apiError(409, 'ACTIVE_GAME_EXISTS', { gameId: 'running00001' }),
      'GET /games/running00001': { body: game({ id: 'running00001', name: 'Идущая игра' }) },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Начать игру' }));
    expect(await screen.findByRole('heading', { name: 'Идущая игра' })).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('В чате уже идёт игра — открываю её.');
  });
});
