// A game in lists: name, date, status, players, money volume, mismatch mark.
import { chipsToMoneyRounded } from '@pokerledger/core';
import { localeOf, type HistoryPageResponse } from '@pokerledger/shared';
import { useTranslation } from 'react-i18next';

import { useFormat } from '../i18n/hooks';
import { ListItem } from './List';

export type GameItem = HistoryPageResponse['items'][number];

export function GameCard({ game, onOpen }: { game: GameItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const format = useFormat();
  const date = new Intl.DateTimeFormat(localeOf(format.language), {
    day: 'numeric',
    month: 'short',
  }).format(game.startedAt);
  const issued = format.money(chipsToMoneyRounded(game.issuedChips, game.stack), game.currency);
  const status = game.status === 'active' ? t('chat.statusActive') : t('chat.statusFinished');
  const mismatch = game.mismatchChips !== null && game.mismatchChips !== 0;
  return (
    <ListItem
      title={game.name}
      subtitle={[date, status, t('chat.players', { count: game.playerCount })].join(' · ')}
      after={
        <>
          {issued}
          {mismatch ? <span className="badge badge-warning">{t('chat.mismatch')}</span> : null}
        </>
      }
      onClick={onOpen}
    />
  );
}
