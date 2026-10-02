// Number and money formatting through `Intl`, shared by the bot and the Mini App.
import type { Language } from './schemas';

const LOCALES: Record<Language, string> = { ru: 'ru-RU', en: 'en-US' };

/** BCP 47 locale of a supported language. */
export function localeOf(language: Language): string {
  return LOCALES[language];
}

const MINUS = '−';

function withMinusSign(text: string): string {
  return text.replace('-', MINUS);
}

/** An integer such as a chip count: `30 000` / `30,000`. */
export function formatNumber(value: number, language: Language): string {
  return withMinusSign(new Intl.NumberFormat(LOCALES[language]).format(value));
}

function moneyFormat(language: Language, currency: string, signed: boolean): Intl.NumberFormat {
  return new Intl.NumberFormat(LOCALES[language], {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    ...(signed ? { signDisplay: 'exceptZero' as const } : {}),
  });
}

/** Integer money in currency units: `1 000 ₽` / `₽1,000`. */
export function formatMoney(amount: number, currency: string, language: Language): string {
  return withMinusSign(moneyFormat(language, currency, false).format(amount));
}

/** A result with an explicit sign: `+1 373 ₽`, `−27 ₽`, `0 ₽`. */
export function formatSignedMoney(amount: number, currency: string, language: Language): string {
  return withMinusSign(moneyFormat(language, currency, true).format(amount));
}

/**
 * Approximate money value of one chip for previews: `0,033 ₽` / `₽0.033`.
 * Display only; amounts use integer arithmetic.
 */
export function formatChipValue(
  stack: { chips: number; amount: number },
  currency: string,
  language: Language,
): string {
  return new Intl.NumberFormat(LOCALES[language], {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    maximumSignificantDigits: 2,
  }).format(stack.amount / stack.chips);
}
