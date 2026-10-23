import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ME, renderApp, type Call } from '../test/testUtils';

const withDetails = { ...ME, payPhone: '+79990001122', payBank: 'Т-Банк', payNote: null };

/** `PATCH /me` that applies the patch to the profile, like the server. */
function patchMe(start = ME) {
  let profile = start;
  return {
    'GET /me': () => ({ body: profile }),
    'PATCH /me': (call: Call) => {
      const patch = call.body as Partial<typeof ME>;
      profile = {
        ...profile,
        ...patch,
        ...(patch.language !== undefined ? { effectiveLanguage: patch.language ?? 'ru' } : {}),
      };
      return { body: profile };
    },
  };
}

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProfilePage', () => {
  it('saves payment details; an empty field is cleared', async () => {
    const { mutations } = renderApp('/profile', patchMe(withDetails));
    const phone = await screen.findByLabelText<HTMLInputElement>('Телефон для СБП');
    expect(phone.value).toBe('+79990001122');
    await userEvent.clear(phone);
    await userEvent.type(screen.getByLabelText('Комментарий'), 'только наличные');
    expect(screen.getByText('15 / 200')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(mutations()).toEqual([
        {
          method: 'PATCH',
          path: '/me',
          body: { payPhone: null, payBank: 'Т-Банк', payNote: 'только наличные' },
        },
      ]);
    });
    expect(await screen.findByText('Реквизиты сохранены')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/только участники игр/)).toBeDefined();
  });

  it('clears all payment details after confirmation', async () => {
    const { mutations } = renderApp('/profile', patchMe(withDetails));
    await userEvent.click(await screen.findByRole('button', { name: 'Очистить реквизиты' }));
    await waitFor(() => {
      expect(mutations()[0]?.body).toEqual({ payPhone: null, payBank: null, payNote: null });
    });
    expect(screen.getByLabelText<HTMLInputElement>('Банк').value).toBe('');
    expect(screen.queryByRole('button', { name: 'Очистить реквизиты' })).toBeNull();
  });

  it('switches the interface language', async () => {
    const { mutations } = renderApp('/profile', patchMe());
    await userEvent.click(await screen.findByRole('radio', { name: 'English' }));
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeDefined();
    expect(mutations()[0]?.body).toEqual({ language: 'en' });
  });
});
