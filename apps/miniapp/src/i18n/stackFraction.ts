// Labels of quick buy-in sizes, which are fractions of a stack.
import { useTranslation } from 'react-i18next';

import { useFormat } from './hooks';

/** Sizes offered in the chat settings. */
export const QUICK_BUYIN_PRESETS: readonly number[] = [0.25, 1 / 3, 0.5, 0.75, 1, 1.5, 2, 3];

const SYMBOLS: readonly [number, string][] = [
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.5, '½'],
  [0.75, '¾'],
  [1.5, '1½'],
];

/** `1 стек`, `½ стека`, `2 стека`. */
export function useStackFractionLabel(): (fraction: number) => string {
  const { t } = useTranslation();
  const format = useFormat();
  return (fraction) => {
    if (fraction === 1) return t('player.fullStack');
    const symbol = SYMBOLS.find(([value]) => Math.abs(value - fraction) < 1e-9)?.[1];
    return t('player.stacks', { fraction: symbol ?? format.number(fraction) });
  };
}
