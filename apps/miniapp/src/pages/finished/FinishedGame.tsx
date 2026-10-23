// A finished game: results and transfers tabs.
import type { MismatchMode } from '@pokerledger/core';
import { localeOf, type GameStateResponse } from '@pokerledger/shared';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { useFormat } from '../../i18n/hooks';
import { MismatchNotice, ResultsSection } from './results';
import { finishedResultRows } from './resultRows';
import { SettlementTab } from './SettlementTab';

type Tab = 'results' | 'settlement';

export function FinishedGame({ game }: { game: GameStateResponse }) {
  const { t } = useTranslation();
  const format = useFormat();
  // The tab lives in the URL so going back and forth keeps it.
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'settlement' ? 'settlement' : 'results';
  const select = (next: Tab) => {
    setParams(next === 'results' ? {} : { tab: next }, { replace: true });
  };

  const mismatch: MismatchMode | undefined =
    game.mismatch === null
      ? undefined
      : game.mismatch.mode === 'single_player' && game.mismatch.playerId !== null
        ? { mode: 'single_player', playerId: game.mismatch.playerId }
        : { mode: 'proportional' };
  const finishedAt =
    game.finishedAt === null
      ? null
      : new Intl.DateTimeFormat(localeOf(format.language), {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(game.finishedAt);

  return (
    <>
      <header>
        <h1 className="page-title">{game.name}</h1>
        {finishedAt !== null ? (
          <p className="hint">{t('results.finishedAt', { date: finishedAt })}</p>
        ) : null}
      </header>
      <Link className="hint-link" to={`/chats/${game.chatId}`}>
        {t('game.toChat')}
      </Link>

      <div className="tabs" role="tablist">
        {(['results', 'settlement'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === value}
            onClick={() => {
              select(value);
            }}
          >
            {value === 'results' ? t('results.tabResults') : t('results.tabSettlement')}
          </button>
        ))}
      </div>

      {tab === 'results' ? (
        <div role="tabpanel">
          {game.mismatch !== null ? (
            <MismatchNotice
              game={game}
              mismatchChips={game.mismatch.chips}
              {...(mismatch ? { mismatch } : {})}
            />
          ) : null}
          <ResultsSection game={game} rows={finishedResultRows(game)} />
        </div>
      ) : (
        <div role="tabpanel">
          <SettlementTab game={game} />
        </div>
      )}
    </>
  );
}
