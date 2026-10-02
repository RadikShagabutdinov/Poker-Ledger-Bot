import { formatMoney, formatNumber, formatSignedMoney, type Language } from '@pokerledger/shared';

import { translator, type T } from '../../i18n';
import type { GameState } from '../../services';
import { gameCallback } from '../callbacks';
import { escapeHtml } from '../html';
import type { MiniAppLinks } from '../links';
import { approxMoney, urlButton, type RenderedMessage } from './common';

/** More seated players than this collapse to names and chips (SPEC §13.2). */
export const DETAILED_SEATED_LIMIT = 15;

type Player = GameState['players'][number];

function seatedDetails(t: T, p: Player): string {
  const parts = [
    p.buyinCount === 1 ? t('status.buyin') : t('status.buyins', { count: p.buyinCount }),
  ];
  if (p.rebuyCount > 0) {
    parts.push(t('status.rebuys', { count: p.rebuyCount }));
  }
  return parts.join(', ');
}

function statusBody(state: GameState, language: Language): string[] {
  const t = translator(language);
  const num = (n: number) => formatNumber(n, language);
  const money = (n: number) => formatMoney(n, state.currency, language);
  const lines = [
    `<b>${t('status.title', { name: escapeHtml(state.name) })}</b>`,
    t('status.stack', {
      count: state.stack.chips,
      chips: num(state.stack.chips),
      amount: money(state.stack.amount),
    }),
    '',
  ];

  const seated = state.players.filter((p) => p.status === 'seated');
  const left = state.players.filter((p) => p.status === 'left');
  const detailed = seated.length <= DETAILED_SEATED_LIMIT;
  if (seated.length > 0) {
    lines.push(t('status.seated'));
    for (const p of seated) {
      const name = escapeHtml(p.name);
      const chips = num(p.inChips);
      lines.push(
        detailed
          ? t('status.seatedPlayer', { name, chips, details: seatedDetails(t, p) })
          : t('status.seatedPlayerShort', { name, chips }),
      );
    }
  }
  if (left.length > 0) {
    lines.push(t('status.left'));
    for (const p of left) {
      lines.push(
        t('status.leftPlayer', {
          name: escapeHtml(p.name),
          in: num(p.inChips),
          out: num(p.outChips),
          result: formatSignedMoney(p.moneyResult ?? 0, state.currency, language),
        }),
      );
    }
  }
  if (seated.length === 0 && left.length === 0) {
    lines.push(t('status.empty'));
  }
  lines.push(
    '',
    t('status.totals', {
      issued: num(state.summary.issuedChips),
      issuedMoney: money(approxMoney(state.summary.issuedChips, state.stack)),
      onTable: num(state.summary.expectedOnTableChips),
    }),
  );
  return lines;
}

/**
 * Pinned status message of an active game (SPEC §13.2, V1-MSG-02/03): no mentions,
 * buttons `j:` / `r:` / `u:` and the «Open» link.
 */
export function renderStatus(
  state: GameState,
  language: Language,
  links: MiniAppLinks,
): RenderedMessage {
  const t = translator(language);
  return {
    text: statusBody(state, language).join('\n'),
    keyboard: {
      inline_keyboard: [
        [
          { text: t('buttons.join'), callback_data: gameCallback('join', state.id) },
          { text: t('buttons.rebuy'), callback_data: gameCallback('rebuy', state.id) },
        ],
        [
          { text: t('buttons.undo'), callback_data: gameCallback('undo', state.id) },
          urlButton(t('buttons.open'), links.to('game', state.id)),
        ],
      ],
    },
  };
}

/** The status message once the game is finished: final state, no buttons. */
export function renderFinishedStatus(state: GameState, language: Language): RenderedMessage {
  const t = translator(language);
  return { text: [...statusBody(state, language), '', t('status.finished')].join('\n') };
}
