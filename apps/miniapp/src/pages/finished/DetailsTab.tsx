// Game parameters and per-player buy-ins, rebuys, chips bought and cashed out.
import { localeOf, type GameStateResponse } from '@pokerledger/shared';
import { useTranslation } from 'react-i18next';

import { useGameLog } from '../../api/queries';
import { ListItem, Section } from '../../components/List';
import { useFormat } from '../../i18n/hooks';

export function DetailsTab({ game }: { game: GameStateResponse }) {
  const { t } = useTranslation();
  const format = useFormat();
  // The API has no creator name; the log entry of the creation carries it.
  const log = useGameLog(game.id);
  const creator =
    log.data?.entries.find((e) => e.type === 'game_created')?.createdBy.name ??
    (log.data ? String(game.createdBy) : '…');
  const dateTime = new Intl.DateTimeFormat(localeOf(format.language), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const players = game.players.filter((p) => p.status !== 'not_joined');

  return (
    <>
      <Section title={t('details.parameters')}>
        <ListItem
          title={t('details.stack')}
          after={t('details.stackValue', {
            chips: format.number(game.stack.chips),
            amount: format.money(game.stack.amount, game.currency),
          })}
        />
        <ListItem title={t('details.currency')} after={game.currency} />
        <ListItem title={t('details.creator')} after={creator} />
        <ListItem title={t('details.started')} after={dateTime.format(game.startedAt)} />
        {game.finishedAt !== null ? (
          <ListItem title={t('details.finished')} after={dateTime.format(game.finishedAt)} />
        ) : null}
      </Section>

      <Section title={t('details.players')}>
        {players.length === 0 ? <p className="hint">{t('results.noResults')}</p> : null}
        {players.map((p) => (
          <ListItem
            key={p.playerId}
            title={p.name}
            subtitle={[
              t('game.buyins', { count: p.buyinCount }),
              t('game.rebuys', { count: p.rebuyCount }),
            ].join(' · ')}
            after={t('details.inOut', {
              in: format.number(p.inChips),
              out: format.number(p.outChips),
            })}
          />
        ))}
      </Section>
    </>
  );
}
