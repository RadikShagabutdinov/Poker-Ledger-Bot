import { describe, expect, it } from 'vitest';

import { formatChipValue, formatMoney, formatNumber, formatSignedMoney } from './format';

// Intl separates groups with a no-break space in ru; compare with plain spaces.
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

describe('formatNumber', () => {
  it('groups digits by locale', () => {
    expect(plain(formatNumber(30_000, 'ru'))).toBe('30 000');
    expect(formatNumber(30_000, 'en')).toBe('30,000');
  });

  it('uses the minus sign', () => {
    expect(plain(formatNumber(-1_000, 'ru'))).toBe('−1 000');
  });
});

describe('formatMoney', () => {
  it('formats whole currency units with the narrow symbol', () => {
    expect(plain(formatMoney(5_500, 'RUB', 'ru'))).toBe('5 500 ₽');
    expect(formatMoney(5_500, 'RUB', 'en')).toBe('₽5,500');
    expect(formatMoney(1_000, 'USD', 'en')).toBe('$1,000');
  });
});

describe('formatSignedMoney', () => {
  it('shows the sign except for zero', () => {
    expect(plain(formatSignedMoney(1_373, 'RUB', 'ru'))).toBe('+1 373 ₽');
    expect(plain(formatSignedMoney(-27, 'RUB', 'ru'))).toBe('−27 ₽');
    expect(plain(formatSignedMoney(0, 'RUB', 'ru'))).toBe('0 ₽');
    expect(formatSignedMoney(-27, 'RUB', 'en')).toBe('−₽27');
  });
});

describe('formatChipValue', () => {
  it('shows the value of one chip with two significant digits', () => {
    expect(plain(formatChipValue({ chips: 30_000, amount: 1_000 }, 'RUB', 'ru'))).toBe('0,033 ₽');
    expect(formatChipValue({ chips: 30_000, amount: 1_000 }, 'RUB', 'en')).toBe('₽0.033');
    expect(formatChipValue({ chips: 100, amount: 500 }, 'USD', 'en')).toBe('$5');
  });
});
