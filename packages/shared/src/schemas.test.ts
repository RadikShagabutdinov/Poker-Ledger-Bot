import { describe, expect, it } from 'vitest';

import {
  ERROR_CODES,
  chatSettingsPatchSchema,
  currencySchema,
  guestNameSchema,
  payNoteSchema,
  profilePatchSchema,
  quickBuyinsSchema,
  stackSchema,
} from './index';

describe('domain schemas', () => {
  it('guest name: trimmed, 1–40 chars', () => {
    expect(guestNameSchema.parse('  Вася  ')).toBe('Вася');
    expect(guestNameSchema.safeParse('   ').success).toBe(false);
    expect(guestNameSchema.safeParse('a'.repeat(40)).success).toBe(true);
    expect(guestNameSchema.safeParse('a'.repeat(41)).success).toBe(false);
  });

  it('pay note: up to 200 chars', () => {
    expect(payNoteSchema.safeParse('x'.repeat(200)).success).toBe(true);
    expect(payNoteSchema.safeParse('x'.repeat(201)).success).toBe(false);
  });

  it('currency: ISO 4217 codes only', () => {
    expect(currencySchema.safeParse('RUB').success).toBe(true);
    expect(currencySchema.safeParse('USD').success).toBe(true);
    expect(currencySchema.safeParse('rub').success).toBe(false);
    expect(currencySchema.safeParse('ZZZ').success).toBe(false);
  });

  it('stack: positive integers', () => {
    expect(stackSchema.safeParse({ chips: 30000, amount: 1000 }).success).toBe(true);
    expect(stackSchema.safeParse({ chips: 0, amount: 1000 }).success).toBe(false);
    expect(stackSchema.safeParse({ chips: 1.5, amount: 1000 }).success).toBe(false);
  });

  it('quick buy-ins: 1–4 positive fractions', () => {
    expect(quickBuyinsSchema.safeParse([1, 0.5]).success).toBe(true);
    expect(quickBuyinsSchema.safeParse([]).success).toBe(false);
    expect(quickBuyinsSchema.safeParse([1, 2, 3, 4, 5]).success).toBe(false);
    expect(quickBuyinsSchema.safeParse([0]).success).toBe(false);
  });

  it('settings and profile patches are partial; profile fields can be cleared', () => {
    expect(chatSettingsPatchSchema.safeParse({}).success).toBe(true);
    expect(chatSettingsPatchSchema.safeParse({ language: 'de' }).success).toBe(false);
    expect(profilePatchSchema.parse({ payPhone: null })).toEqual({ payPhone: null });
  });

  it('error codes include the SPEC §11 codes', () => {
    for (const code of ['UNAUTHORIZED', 'NOT_CHAT_MEMBER', 'CONFLICT', 'MISSING_FINAL_CHIPS']) {
      expect(ERROR_CODES).toContain(code);
    }
  });
});
