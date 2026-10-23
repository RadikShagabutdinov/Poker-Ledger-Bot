import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CHAT, plain, renderApp } from '../test/testUtils';

function routes() {
  return {
    'GET /chats/chat1': { body: { ...CHAT, nextGameNumber: 8 } },
    'PATCH /chats/chat1/settings': { body: { ...CHAT, currency: 'USD', nextGameNumber: 8 } },
  };
}

describe('ChatSettingsPage', () => {
  it('validates the fields', async () => {
    renderApp('/chats/chat1/settings', routes());
    const currency = await screen.findByLabelText('Валюта');
    await userEvent.clear(currency);
    await userEvent.type(currency, 'xxq');
    expect(screen.getByText('Неизвестный код валюты')).toBeDefined();
    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect(save).toHaveProperty('disabled', true);

    await userEvent.clear(currency);
    await userEvent.type(currency, 'usd');
    expect(save).toHaveProperty('disabled', false);

    await userEvent.clear(screen.getByLabelText('Фишек в стеке'));
    expect(save).toHaveProperty('disabled', true);
  });

  it('allows one to four quick buy-in sizes', async () => {
    renderApp('/chats/chat1/settings', routes());
    const group = (await screen.findByText('Быстрые кнопки покупки')).closest('section');
    const buttons = within(group as HTMLElement);
    // ½ and 1 stack are on; two more fit, then the rest are disabled.
    await userEvent.click(buttons.getByRole('button', { name: '2 стека' }));
    await userEvent.click(buttons.getByRole('button', { name: '3 стека' }));
    expect(buttons.getByRole('button', { name: '¼ стека' })).toHaveProperty('disabled', true);
    expect(buttons.getByRole('button', { name: '1 стек', pressed: true })).toBeDefined();
  });

  it('previews the name template and sends only changed fields', async () => {
    const { mutations } = renderApp('/chats/chat1/settings', routes());
    const template = await screen.findByLabelText('Шаблон');
    await userEvent.clear(template);
    await userEvent.type(template, 'Игра №{{n}');
    expect(plain(screen.getByText(/Следующая игра/).textContent)).toBe('Следующая игра: Игра №8');

    const currency = screen.getByLabelText('Валюта');
    await userEvent.clear(currency);
    await userEvent.type(currency, 'USD');
    await userEvent.click(screen.getByRole('radio', { name: 'English' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(mutations()).toEqual([
        {
          method: 'PATCH',
          path: '/chats/chat1/settings',
          body: { currency: 'USD', gameNameTemplate: 'Игра №{n}', language: 'en' },
        },
      ]);
    });
    expect(await screen.findByText('Настройки сохранены')).toBeDefined();
  });
});
