import { describe, expect, it } from 'vitest';

import { formatIntegerInput, parseIntegerInput } from './integerInput';

const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

describe('parseIntegerInput', () => {
  it('accepts whole numbers with group separators', () => {
    expect(parseIntegerInput('30000', 'ru')).toEqual({ ok: true, value: 30_000 });
    expect(parseIntegerInput('30 000', 'ru')).toEqual({ ok: true, value: 30_000 });
    expect(parseIntegerInput('30\u202f000', 'ru')).toEqual({ ok: true, value: 30_000 });
    expect(parseIntegerInput('30,000', 'en')).toEqual({ ok: true, value: 30_000 });
    expect(parseIntegerInput(' 0 ', 'en')).toEqual({ ok: true, value: 0 });
  });

  it('treats an empty field as no value', () => {
    expect(parseIntegerInput('', 'ru')).toEqual({ ok: true, value: null });
    expect(parseIntegerInput('   ', 'en')).toEqual({ ok: true, value: null });
  });

  it('rejects negatives', () => {
    expect(parseIntegerInput('-5', 'ru')).toEqual({ ok: false, error: 'negative' });
    expect(parseIntegerInput('−5', 'en')).toEqual({ ok: false, error: 'negative' });
  });

  it('rejects fractions instead of truncating them', () => {
    expect(parseIntegerInput('1,5', 'ru')).toEqual({ ok: false, error: 'fraction' });
    expect(parseIntegerInput('1.5', 'ru')).toEqual({ ok: false, error: 'fraction' });
    expect(parseIntegerInput('1.5', 'en')).toEqual({ ok: false, error: 'fraction' });
  });

  it('rejects other characters and unsafe numbers', () => {
    expect(parseIntegerInput('12a', 'ru')).toEqual({ ok: false, error: 'invalid' });
    expect(parseIntegerInput('1e5', 'en')).toEqual({ ok: false, error: 'invalid' });
    expect(parseIntegerInput('99999999999999999', 'en')).toEqual({
      ok: false,
      error: 'too_large',
    });
  });
});

describe('formatIntegerInput', () => {
  it('groups digits by locale', () => {
    expect(plain(formatIntegerInput(12_345, 'ru'))).toBe('12 345');
    expect(formatIntegerInput(12_345, 'en')).toBe('12,345');
    expect(formatIntegerInput(null, 'en')).toBe('');
  });

  it('round-trips through the parser', () => {
    for (const language of ['ru', 'en'] as const) {
      const text = formatIntegerInput(1_234_567, language);
      expect(parseIntegerInput(text, language)).toEqual({ ok: true, value: 1_234_567 });
    }
  });
});
