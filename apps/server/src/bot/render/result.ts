import { formatMoney, formatNumber, formatSignedMoney, type Language } from '@pokerledger/shared';

import { translator } from '../../i18n';
import type { GameMessageData } from '../../services';
import { escapeHtml, mention } from '../html';
import type { MiniAppLinks } from '../links';
import { approxMoney, urlButton, type RenderedMessage } from './common';

/**
 * Result message of a finished game: results
 * with mentions of Telegram players, transfers without payment details,
 * the chip mismatch and markers of a manual or unbalanced settlement.
 */
export function renderResult(
  data: Pick<GameMessageData, 'state' | 'settlement' | 'mentions'>,
  language: Language,
  links: MiniAppLinks,
): RenderedMessage {
  const { state, settlement, mentions } = data;
  const t = translator(language);
  const money = (n: number) => formatMoney(n, state.currency, language);
  const names = new Map(state.players.map((p) => [p.playerId, p.name]));
  const nameOf = (playerId: string) => escapeHtml(names.get(playerId) ?? '');

  const results = state.players
    .filter((p) => p.moneyResult !== null)
    .map((p) => ({ ...p, money: p.moneyResult ?? 0 }))
    .sort((a, b) => b.money - a.money || a.seatOrder - b.seatOrder);

  const lines = [
    `<b>${t('result.title', { name: escapeHtml(state.name), count: results.length })}</b>`,
    '',
    t('result.results'),
  ];
  for (const p of results) {
    const tgUserId = mentions.get(p.playerId);
    lines.push(
      t('result.resultLine', {
        name: tgUserId === undefined ? escapeHtml(p.name) : mention(tgUserId, p.name),
        result: formatSignedMoney(p.money, state.currency, language),
      }),
    );
  }

  lines.push('', t('result.transfers'));
  const transfers = settlement?.transfers ?? [];
  if (transfers.length === 0) {
    lines.push(t('result.noTransfers'));
  }
  for (const transfer of transfers) {
    lines.push(
      t('result.transferLine', {
        from: nameOf(transfer.from),
        to: nameOf(transfer.to),
        amount: money(transfer.amount),
      }),
    );
  }

  const notes: string[] = [];
  if (state.mismatch && state.mismatch.chips !== 0) {
    const chips = Math.abs(state.mismatch.chips);
    const key = state.mismatch.chips < 0 ? 'result.mismatchLess' : 'result.mismatchMore';
    const how =
      state.mismatch.mode === 'single_player' && state.mismatch.playerId !== null
        ? t('result.mismatchSingle', { name: nameOf(state.mismatch.playerId) })
        : t('result.mismatchProportional');
    notes.push(
      `${t(key, {
        count: chips,
        chips: formatNumber(chips, language),
        money: money(approxMoney(chips, state.stack)),
      })} ${how}`,
    );
  }
  if (settlement?.isManual) {
    notes.push(t('result.manual'));
  }
  if (settlement && settlement.warnings.length > 0) {
    notes.push(t('result.unbalanced'));
  }
  if (notes.length > 0) {
    lines.push('', ...notes);
  }

  return {
    text: lines.join('\n'),
    keyboard: { inline_keyboard: [[urlButton(t('buttons.details'), links.to('game', state.id))]] },
  };
}

/** The old result message after the game was reopened. */
export function renderReopened(name: string, language: Language): RenderedMessage {
  return { text: translator(language)('result.reopened', { name: escapeHtml(name) }) };
}

/** Status or result message of a deleted game. */
export function renderDeleted(name: string, language: Language): RenderedMessage {
  return { text: translator(language)('result.deleted', { name: escapeHtml(name) }) };
}
