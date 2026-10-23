import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../test/testUtils';

describe('MyChatsPage', () => {
  it('lists chats with the active game mark and links the profile', async () => {
    renderApp('/', {
      'GET /me/chats': {
        body: {
          chats: [
            { chatId: 'chat1', title: 'Покерный клуб', activeGameIds: ['game00000001'] },
            { chatId: 'chat2', title: 'Работа', activeGameIds: [] },
          ],
        },
      },
    });
    const club = await screen.findByRole('button', { name: /Покерный клуб/ });
    expect(club.textContent).toContain('идёт игра');
    expect(screen.getByRole('button', { name: 'Работа' }).textContent).not.toContain('идёт');
    await userEvent.click(screen.getByRole('link', { name: 'Профиль' }));
    expect(await screen.findByRole('heading', { name: 'Профиль' })).toBeDefined();
  });

  it('explains how to get a chat here', async () => {
    renderApp('/', { 'GET /me/chats': { body: { chats: [] } } });
    expect(await screen.findByText(/Добавьте бота в группу/)).toBeDefined();
  });
});
