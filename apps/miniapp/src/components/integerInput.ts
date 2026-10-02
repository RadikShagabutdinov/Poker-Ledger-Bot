// Parsing of whole-number inputs (SPEC §12.5): digit grouping, no negatives or fractions.
import { formatNumber, type Language } from '@pokerledger/shared';

export type IntegerInputError = 'negative' | 'fraction' | 'invalid' | 'too_large';

export type IntegerInput =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly error: IntegerInputError };

/** Group separators a user may type or paste besides spaces. */
const GROUP_SEPARATORS: Record<Language, RegExp> = { ru: /[\s']/g, en: /[\s,']/g };
/** Decimal separators: a fraction is rejected, not truncated. */
const DECIMAL_SEPARATORS: Record<Language, RegExp> = { ru: /[.,]/, en: /\./ };

/** `null` for an empty field. */
export function parseIntegerInput(text: string, language: Language): IntegerInput {
  const compact = text.replace(GROUP_SEPARATORS[language], '');
  if (compact === '') {
    return { ok: true, value: null };
  }
  if (/^[-−–]/.test(compact)) {
    return { ok: false, error: 'negative' };
  }
  if (DECIMAL_SEPARATORS[language].test(compact)) {
    return { ok: false, error: 'fraction' };
  }
  if (!/^\d+$/.test(compact)) {
    return { ok: false, error: 'invalid' };
  }
  const value = Number(compact);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, error: 'too_large' };
  }
  return { ok: true, value };
}

/** Grouped digits for the field: `30 000` / `30,000`. */
export function formatIntegerInput(value: number | null, language: Language): string {
  return value === null ? '' : formatNumber(value, language);
}
