import { errorBodySchema, profileResponseSchema } from '@pokerledger/shared';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { findUser } from '../db/repositories/users';
import { ALICE, BOB } from '../services/testing';
import { createTestApp, initDataFor } from './testing';

const HOUR = 60 * 60 * 1000;

async function status(
  app: ReturnType<typeof createTestApp>,
  authorization: string | undefined,
): Promise<{ status: number; code?: string }> {
  const response = await app.call(null, 'GET', '/me', {
    headers: authorization === undefined ? {} : { Authorization: authorization },
  });
  if (response.status === 200) {
    return { status: 200 };
  }
  return { status: response.status, code: errorBodySchema.parse(await response.json()).error.code };
}

describe('initData auth', () => {
  it('accepts valid initData and returns the profile', async () => {
    const app = createTestApp();
    const profile = profileResponseSchema.parse(await app.json(ALICE, 'GET', '/me'));
    expect(profile).toMatchObject({ tgUserId: ALICE.tgUserId, firstName: 'Alice' });
  });

  it('accepts initData up to 24 hours old and rejects older', async () => {
    const app = createTestApp();
    const fresh = initDataFor(ALICE, { authDate: new Date(Date.now() - 23 * HOUR) });
    const expired = initDataFor(ALICE, { authDate: new Date(Date.now() - 25 * HOUR) });
    expect(await status(app, `tma ${fresh}`)).toEqual({ status: 200 });
    expect(await status(app, `tma ${expired}`)).toEqual({ status: 401, code: 'UNAUTHORIZED' });
  });

  it('rejects a forged signature', async () => {
    const app = createTestApp();
    const otherBot = initDataFor(ALICE, { token: '999:OTHER' });
    // A valid signature for Bob with the user swapped to Alice.
    const swapped = initDataFor(BOB).replace(
      /user=[^&]+/,
      `user=${encodeURIComponent(JSON.stringify({ id: ALICE.tgUserId, first_name: 'Alice' }))}`,
    );
    for (const raw of [otherBot, swapped]) {
      expect(await status(app, `tma ${raw}`)).toEqual({ status: 401, code: 'UNAUTHORIZED' });
    }
  });

  it('rejects a missing or malformed header', async () => {
    const app = createTestApp();
    for (const header of [undefined, '', 'tma ', `Bearer ${initDataFor(ALICE)}`, 'tma garbage']) {
      expect(await status(app, header)).toEqual({ status: 401, code: 'UNAUTHORIZED' });
    }
  });

  it('rejects initData without a user', async () => {
    const app = createTestApp();
    const raw = initDataFor(ALICE).replace(/user=[^&]+&/, '');
    expect(await status(app, `tma ${raw}`)).toEqual({ status: 401, code: 'UNAUTHORIZED' });
  });

  it('refreshes the user name on every request', async () => {
    const app = createTestApp();
    await app.json(ALICE, 'GET', '/me/chats');
    await app.json({ ...ALICE, firstName: 'Alicia', lastName: 'B.' }, 'GET', '/me/chats');
    expect(findUser(app.deps.db, ALICE.tgUserId)).toMatchObject({
      firstName: 'Alicia',
      lastName: 'B.',
    });
  });

  it('DEV_SKIP_INIT_DATA_CHECK reads the user without checking the signature', async () => {
    const app = createTestApp({ skipInitDataCheck: true });
    const unsigned = `user=${encodeURIComponent(JSON.stringify({ id: 7, first_name: 'Dev' }))}&auth_date=1&hash=x`;
    expect(await status(app, `tma ${unsigned}`)).toEqual({ status: 200 });
    expect(await status(app, 'tma auth_date=1')).toEqual({ status: 401, code: 'UNAUTHORIZED' });
  });
});

describe('server config', () => {
  const base = {
    BOT_TOKEN: '1:x',
    BOT_USERNAME: 'poker_ledger_bot',
    MINIAPP_SHORT_NAME: 'app',
  };

  it('refuses to start with DEV_SKIP_INIT_DATA_CHECK in production', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      MINIAPP_ORIGIN: 'https://example.github.io',
    };
    expect(loadConfig(production).devSkipInitDataCheck).toBe(false);
    expect(() => loadConfig({ ...production, DEV_SKIP_INIT_DATA_CHECK: 'true' })).toThrow(
      /DEV_SKIP_INIT_DATA_CHECK/,
    );
    expect(loadConfig({ ...base, DEV_SKIP_INIT_DATA_CHECK: 'true' }).devSkipInitDataCheck).toBe(
      true,
    );
  });

  it('requires MINIAPP_ORIGIN in production and keeps only the origin', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/MINIAPP_ORIGIN/);
    expect(
      loadConfig({ ...base, MINIAPP_ORIGIN: 'https://example.github.io/poker/', PORT: '8080' }),
    ).toMatchObject({ miniAppOrigin: 'https://example.github.io', port: 8080 });
    expect(loadConfig(base)).toMatchObject({ miniAppOrigin: undefined, port: 3000 });
  });
});
