import {
  formatMoney,
  formatNumber,
  formatSignedMoney,
  type ErrorCode,
  type Language,
} from '@pokerledger/shared';
import { useTranslation } from 'react-i18next';

import { isApiError } from '../api/client';

export function useLanguage(): Language {
  const { i18n } = useTranslation();
  return i18n.language === 'en' ? 'en' : 'ru';
}

/** Number and money formatting in the current language. */
export function useFormat() {
  const language = useLanguage();
  return {
    language,
    number: (value: number) => formatNumber(value, language),
    money: (amount: number, currency: string) => formatMoney(amount, currency, language),
    signedMoney: (amount: number, currency: string) =>
      formatSignedMoney(amount, currency, language),
  };
}

/** Translates an error by its API code; unknown failures get a generic text. */
export function useErrorText(): (error: unknown) => string {
  const { t } = useTranslation();
  return (error) => {
    if (!isApiError(error)) {
      return t('errors.INTERNAL_ERROR');
    }
    const reason = error.details?.reason;
    if (error.status === 0 && reason === 'NETWORK') {
      return t('errors.NETWORK');
    }
    if (error.code === 'INVALID_EVENT_SEQUENCE' && typeof reason === 'string') {
      const key = `errors.INVALID_EVENT_SEQUENCE_${reason}`;
      return t(key as 'errors.INVALID_EVENT_SEQUENCE', {
        defaultValue: t('errors.INVALID_EVENT_SEQUENCE'),
      });
    }
    return t(`errors.${error.code satisfies ErrorCode}`);
  };
}
