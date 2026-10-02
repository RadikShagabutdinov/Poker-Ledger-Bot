import i18next, { type TFunction } from 'i18next';

import type { Language } from '@pokerledger/shared';

import en from './locales/en.json' with { type: 'json' };
import ru from './locales/ru.json' with { type: 'json' };

// Bot texts. A new language is one more locale file.
const instance = i18next.createInstance();
void instance.init({
  resources: { ru: { translation: ru }, en: { translation: en } },
  fallbackLng: 'en',
  initAsync: false,
  // Messages use HTML; renderers escape user strings themselves, and
  // callback notifications are plain text.
  interpolation: { escapeValue: false },
});

export type T = TFunction;

/** Texts in one language; plurals by `count`. */
export function translator(language: Language): T {
  return instance.getFixedT(language);
}
