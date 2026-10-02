// i18next for the Mini App (SPEC §15): ru/en, one file per language (I18N-01).
import type { Language } from '@pokerledger/shared';
import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '../locales/en.json';
import ru from '../locales/ru.json';

export const resources = { ru: { translation: ru }, en: { translation: en } } as const;

/** Telegram `language_code` → app language: `ru*` → ru, anything else → en (V1-PROF-01). */
export function languageFromCode(code: string | undefined): Language {
  return code?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function createI18n(language: Language): i18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'ru',
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance;
}
