// A finished game: results, transfers, details and log tabs; edit, reopen and delete for the
// creator and chat admins.
import type { MismatchMode } from '@pokerledger/core';
import { localeOf, type GameStateResponse } from '@pokerledger/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { BottomSheet } from '../../components/BottomSheet';
import { ListItem } from '../../components/List';
import { useFormat } from '../../i18n/hooks';
import { GameLog } from '../game/GameLogPage';
import { useDeleteGame, useReopenGame } from '../game/lifecycle';
import { DetailsTab } from './DetailsTab';
import { MismatchNotice, ResultsSection } from './results';
import { finishedResultRows } from './resultRows';
import { SettlementTab } from './SettlementTab';

const TABS = ['results', 'settlement', 'details', 'log'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS = {
  results: 'results.tabResults',
  settlement: 'results.tabSettlement',
  details: 'results.tabDetails',
  log: 'results.tabLog',
} as const;

function isTab(value: string | null): value is Tab {
  return TABS.includes(value as Tab);
}

export function FinishedGame({ game }: { game: GameStateResponse }) {
  const { t } = useTranslation();
  const format = useFormat();
  // The tab lives in the URL so going back and forth keeps it.
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = isTab(raw) ? raw : 'results';
  const select = (next: Tab) => {
    setParams(next === 'results' ? {} : { tab: next }, { replace: true });
  };
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => {
    setMenuOpen(false);
  };
  // Kept here, not in the menu: the menu closes before the confirmation is answered.
  const reopen = useReopenGame(game);
  const remove = useDeleteGame(game);

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
      <header className="game-header">
        <div>
          <h1 className="page-title">{game.name}</h1>
          {finishedAt !== null ? (
            <p className="hint">{t('results.finishedAt', { date: finishedAt })}</p>
          ) : null}
        </div>
        {game.permissions.canEditFinished ? (
          <button
            type="button"
            className="icon-button"
            aria-label={t('game.menu')}
            onClick={() => {
              setMenuOpen(true);
            }}
          >
            ⋯
          </button>
        ) : null}
      </header>
      <Link className="hint-link" to={`/chats/${game.chatId}`}>
        {t('game.toChat')}
      </Link>

      <div className="tabs" role="tablist">
        {TABS.map((value) => (
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
            {t(TAB_LABELS[value])}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'results' ? (
          <>
            {game.mismatch !== null ? (
              <MismatchNotice
                game={game}
                mismatchChips={game.mismatch.chips}
                {...(mismatch ? { mismatch } : {})}
              />
            ) : null}
            <ResultsSection game={game} rows={finishedResultRows(game)} />
          </>
        ) : tab === 'settlement' ? (
          <SettlementTab game={game} />
        ) : tab === 'details' ? (
          <DetailsTab game={game} />
        ) : (
          <GameLog game={game} />
        )}
      </div>

      <BottomSheet open={menuOpen} onClose={closeMenu} title={t('game.menu')}>
        <ListItem
          title={t('gameMenu.edit')}
          onClick={() => void navigate(`/games/${game.id}/edit`)}
        />
        <ListItem
          title={t('gameMenu.reopen')}
          onClick={() => {
            if (reopen.isPending) return;
            closeMenu();
            void reopen.run();
          }}
        />
        <ListItem
          title={t('gameMenu.delete')}
          className="item-destructive"
          onClick={() => {
            if (remove.isPending) return;
            closeMenu();
            void remove.run();
          }}
        />
      </BottomSheet>
    </>
  );
}
