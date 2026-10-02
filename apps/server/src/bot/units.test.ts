import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { gameCallback, parseGameCallback } from './callbacks';
import { MEMBERSHIP_TTL_MS, TelegramMembershipChecker } from './membership';
import { PressRateLimiter } from './rateLimit';
import { FakeTelegram, fakeApi } from './testing';

describe('callback data', () => {
  it('round-trips and fits 64 bytes', () => {
    const data = gameCallback('rebuy', 'Ab_-0123456z');
    expect(data).toBe('r:Ab_-0123456z');
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(parseGameCallback(data)).toEqual({ action: 'rebuy', gameId: 'Ab_-0123456z' });
    expect(parseGameCallback('j:short')).toBeUndefined();
    expect(parseGameCallback('x:Ab_-0123456z')).toBeUndefined();
  });
});

describe('PressRateLimiter', () => {
  it('allows one press per second per user', () => {
    let now = 0;
    const limiter = new PressRateLimiter(() => now);
    expect(limiter.tryPress(1)).toBe(true);
    expect(limiter.tryPress(1)).toBe(false);
    expect(limiter.tryPress(2)).toBe(true);
    now = 999;
    expect(limiter.tryPress(1)).toBe(false);
    now = 1000;
    expect(limiter.tryPress(1)).toBe(true);
  });
});

describe('TelegramMembershipChecker', () => {
  it('maps statuses and caches them for 10 minutes', async () => {
    const telegram = new FakeTelegram();
    let now = 0;
    const checker = new TelegramMembershipChecker(fakeApi(telegram), () => now);
    telegram.setMember(-1, 1, 'creator');
    telegram.setMember(-1, 2, 'member');
    telegram.setMember(-1, 3, 'restricted');
    telegram.setMember(-1, 4, 'kicked');
    expect(await checker.getMembership(-1, 1)).toBe('admin');
    expect(await checker.getMembership(-1, 2)).toBe('member');
    expect(await checker.getMembership(-1, 3)).toBe('member');
    expect(await checker.getMembership(-1, 4)).toBe('none');

    telegram.setMember(-1, 2, 'left');
    expect(await checker.getMembership(-1, 2)).toBe('member');
    expect(telegram.callsOf('getChatMember')).toHaveLength(4);
    now = MEMBERSHIP_TTL_MS;
    expect(await checker.getMembership(-1, 2)).toBe('none');
  });

  it('treats Telegram rejections as non-members and rethrows other failures', async () => {
    const telegram = new FakeTelegram();
    const checker = new TelegramMembershipChecker(fakeApi(telegram), () => 0);
    telegram.fail('getChatMember', 400, 'Bad Request: PARTICIPANT_ID_INVALID');
    expect(await checker.getMembership(-1, 5)).toBe('none');
    telegram.fail('getChatMember', 500, 'Internal Server Error');
    await expect(checker.getMembership(-1, 6)).rejects.toThrow();
  });
});

describe('loadConfig', () => {
  const base = { BOT_TOKEN: '1:x', BOT_USERNAME: 'poker_ledger_bot', MINIAPP_SHORT_NAME: 'app' };

  it('applies defaults and treats empty values as unset', () => {
    expect(loadConfig({ ...base, MINIAPP_URL: '' })).toMatchObject({
      nodeEnv: 'development',
      miniAppUrl: undefined,
      databasePath: './data/poker.db',
      logLevel: 'info',
    });
  });

  it('names invalid variables without their values', () => {
    expect(() => loadConfig({ ...base, BOT_TOKEN: '', MINIAPP_URL: 'http://x' })).toThrow(
      'Invalid environment variables: BOT_TOKEN, MINIAPP_URL',
    );
  });
});
