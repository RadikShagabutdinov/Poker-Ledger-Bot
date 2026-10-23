// Results and transfers shown both in the finish preview and on a finished game.
import { chipsToMoneyRounded, type MismatchMode } from '@pokerledger/core';
import type { GameStateResponse } from '@pokerledger/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ListItem, Section } from '../../components/List';
import { useFormat } from '../../i18n/hooks';
import { playerNameOf } from '../game/events';
import type { ResultRow } from './resultRows';

export function SignedMoney({ amount, currency }: { amount: number; currency: string }) {
  const format = useFormat();
  return (
    <span className={amount > 0 ? 'positive' : amount < 0 ? 'negative' : undefined}>
      {format.signedMoney(amount, currency)}
    </span>
  );
}

/** Players by money result, best first; ties keep the seat order. */
export function ResultsSection({
  game,
  rows,
  title,
}: {
  game: GameStateResponse;
  rows: readonly ResultRow[];
  title?: string;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const sorted = [...rows].sort((a, b) => b.moneyResult - a.moneyResult);
  const signedChips = (chips: number) => (chips > 0 ? '+' : '') + format.number(chips);
  return (
    <Section {...(title !== undefined ? { title } : {})}>
      {sorted.length === 0 ? <p className="hint">{t('results.noResults')}</p> : null}
      {sorted.map((row) => (
        <ListItem
          key={row.playerId}
          title={playerNameOf(game, row.playerId)}
          subtitle={t('results.line', {
            in: format.number(row.inChips),
            out: format.number(row.outChips),
            chips: signedChips(row.chipResult),
          })}
          after={<SignedMoney amount={row.moneyResult} currency={game.currency} />}
        />
      ))}
    </Section>
  );
}

/**
 * The chip mismatch and, when `mismatch` is given, how it was accounted for; nothing
 * when the chips matched.
 */
export function MismatchNotice({
  game,
  mismatchChips,
  mismatch,
}: {
  game: GameStateResponse;
  mismatchChips: number;
  mismatch?: MismatchMode;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  if (mismatchChips === 0) return null;
  const abs = Math.abs(mismatchChips);
  const values = {
    count: abs,
    chips: format.number(abs),
    money: format.money(chipsToMoneyRounded(abs, game.stack), game.currency),
  };
  return (
    <div className="notice" role="status">
      <p>
        ⚠️{' '}
        {mismatchChips < 0 ? t('results.mismatchLess', values) : t('results.mismatchMore', values)}
      </p>
      {mismatch ? (
        <p>
          {mismatch.mode === 'single_player'
            ? t('results.mismatchSingle', { name: playerNameOf(game, mismatch.playerId) })
            : t('results.mismatchProportional')}
        </p>
      ) : null}
    </div>
  );
}

export interface TransferView {
  readonly from: string;
  readonly to: string;
  readonly amount: number;
}

/** `Вася → Петя · 1 373 ₽`; transfers of the current user are highlighted. */
export function TransferItem({
  game,
  transfer,
  children,
}: {
  game: GameStateResponse;
  transfer: TransferView;
  /** Shown under the row, e.g. payment details. */
  children?: ReactNode;
}) {
  const format = useFormat();
  const mine =
    game.myPlayerId !== null &&
    (transfer.from === game.myPlayerId || transfer.to === game.myPlayerId);
  return (
    <div className={mine ? 'transfer transfer-mine' : 'transfer'} data-mine={mine || undefined}>
      <div className="transfer-row">
        <span className="transfer-names">
          {playerNameOf(game, transfer.from)} → {playerNameOf(game, transfer.to)}
        </span>
        <span className="transfer-amount">{format.money(transfer.amount, game.currency)}</span>
      </div>
      {children}
    </div>
  );
}
