// Active game: header and menu, summary, players, actions, undo, finish.
import { chipsToMoneyRounded } from '@pokerledger/core';
import type { GameStateResponse } from '@pokerledger/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { useApi } from '../../api/apiContext';
import { useGame, useGameMutation } from '../../api/queries';
import { BottomSheet } from '../../components/BottomSheet';
import { ListItem, Section } from '../../components/List';
import { QueryView } from '../../components/Status';
import { useToast } from '../../components/toastContext';
import { useFormat } from '../../i18n/hooks';
import { useConfirm } from '../../telegram/nativeUi';
import { BackButton, MainButton } from '../../telegram/TelegramUi';
import { AddPlayerSheet } from './AddPlayerSheet';
import { describeChipEvent, playerNameOf } from './events';
import { RenameSheet, StackSheet } from './GameSettingsSheets';
import { PlayerSheet } from './PlayerSheet';

type GamePlayer = GameStateResponse['players'][number];

export function GamePage() {
  const { gameId = '' } = useParams();
  const game = useGame(gameId);
  return (
    <main className="page page-game">
      <BackButton />
      <QueryView query={game}>
        {(data) => (data.status === 'active' ? <ActiveGame game={data} /> : <NotActive />)}
      </QueryView>
    </main>
  );
}

function NotActive() {
  const { t } = useTranslation();
  return <p className="hint">{t('game.notActive')}</p>;
}

type Sheet =
  | { kind: 'menu' }
  | { kind: 'rename' }
  | { kind: 'stack' }
  | { kind: 'add' }
  | { kind: 'player'; playerId: string };

function ActiveGame({ game }: { game: GameStateResponse }) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const api = useApi();
  const toast = useToast();
  const confirm = useConfirm();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const close = () => {
    setSheet(null);
  };
  const canManage = game.permissions.canManage;

  const undo = useGameMutation(game.id, () => api.undo(game.id));
  const onUndo = async () => {
    const ok = await confirm({ message: t('game.undoConfirm'), ok: t('game.undoLast') });
    if (!ok) return;
    undo.mutate(undefined, {
      onSuccess: ({ event, game: fresh }) => {
        if (event) {
          const what = describeChipEvent(t, format, {
            ...event,
            playerName: playerNameOf(fresh, event.playerId),
          });
          toast.info(t('game.undone', { what }));
        }
      },
      onError: toast.error,
    });
  };

  const money = (chips: number) =>
    format.money(chipsToMoneyRounded(chips, game.stack), game.currency);
  const groups: [string, GamePlayer[]][] = [
    [t('game.groupSeated'), game.players.filter((p) => p.status === 'seated')],
    [t('game.groupNotJoined'), game.players.filter((p) => p.status === 'not_joined')],
    [t('game.groupLeft'), game.players.filter((p) => p.status === 'left')],
  ];

  return (
    <>
      <header className="game-header">
        <div>
          <h1 className="page-title">{game.name}</h1>
          <p className="hint">
            {t('game.stack', {
              chips: format.number(game.stack.chips),
              amount: format.money(game.stack.amount, game.currency),
            })}
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t('game.menu')}
          onClick={() => {
            setSheet({ kind: 'menu' });
          }}
        >
          ⋯
        </button>
      </header>
      <Link className="hint-link" to={`/chats/${game.chatId}`}>
        {t('game.toChat')}
      </Link>

      <Section title={t('game.summary')}>
        <ListItem
          title={t('game.issued')}
          after={`${format.number(game.summary.issuedChips)} · ${money(game.summary.issuedChips)}`}
        />
        <ListItem title={t('game.cashedOut')} after={format.number(game.summary.cashedOutChips)} />
        <ListItem
          title={t('game.onTable')}
          after={format.number(game.summary.expectedOnTableChips)}
        />
        <ListItem title={t('game.seatedCount')} after={format.number(game.summary.seatedCount)} />
      </Section>

      {game.players.length === 0 ? <p className="hint">{t('game.noPlayers')}</p> : null}
      {groups.map(([title, players]) =>
        players.length === 0 ? null : (
          <Section key={title} title={title}>
            {players.map((player) => (
              <PlayerRow
                key={player.playerId}
                player={player}
                currency={game.currency}
                {...(canManage
                  ? {
                      onOpen: () => {
                        setSheet({ kind: 'player', playerId: player.playerId });
                      },
                    }
                  : {})}
              />
            ))}
          </Section>
        ),
      )}

      {canManage ? (
        <>
          <button
            type="button"
            className="button button-wide"
            onClick={() => {
              setSheet({ kind: 'add' });
            }}
          >
            {t('game.addPlayer')}
          </button>
          <button
            type="button"
            className="fab"
            disabled={undo.isPending}
            onClick={() => void onUndo()}
          >
            ↩ {t('game.undoLast')}
          </button>
          <MainButton
            text={t('game.finish')}
            onClick={() => void navigate(`/games/${game.id}/finish`)}
          />
        </>
      ) : (
        <p className="hint">{t('game.readOnly')}</p>
      )}

      <BottomSheet open={sheet?.kind === 'menu'} onClose={close} title={t('game.menu')}>
        {canManage ? (
          <>
            <ListItem
              title={t('game.rename')}
              onClick={() => {
                setSheet({ kind: 'rename' });
              }}
            />
            <ListItem
              title={t('game.changeStack')}
              onClick={() => {
                setSheet({ kind: 'stack' });
              }}
            />
          </>
        ) : null}
        <ListItem title={t('game.log')} onClick={() => void navigate(`/games/${game.id}/log`)} />
      </BottomSheet>
      {sheet?.kind === 'rename' ? <RenameSheet game={game} onClose={close} /> : null}
      {sheet?.kind === 'stack' ? <StackSheet game={game} onClose={close} /> : null}
      {sheet?.kind === 'add' ? (
        <AddPlayerSheet
          game={game}
          onClose={close}
          onAdded={(playerId) => {
            setSheet({ kind: 'player', playerId });
          }}
        />
      ) : null}
      {sheet?.kind === 'player' ? (
        <PlayerSheet game={game} playerId={sheet.playerId} onClose={close} />
      ) : null}
    </>
  );
}

function PlayerRow({
  player,
  currency,
  onOpen,
}: {
  player: GamePlayer;
  currency: string;
  onOpen?: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const parts =
    player.status === 'not_joined'
      ? []
      : [
          t('game.bought', { chips: format.number(player.inChips) }),
          t('game.buyins', { count: player.buyinCount }),
          ...(player.rebuyCount > 0 ? [t('game.rebuys', { count: player.rebuyCount })] : []),
          ...(player.status === 'left'
            ? [t('game.out', { chips: format.number(player.outChips) })]
            : []),
        ];
  const result =
    player.status === 'left' && player.moneyResult !== null ? player.moneyResult : null;
  return (
    <ListItem
      title={player.name}
      {...(parts.length > 0 ? { subtitle: parts.join(' · ') } : {})}
      {...(result !== null
        ? {
            after: (
              <span className={result > 0 ? 'positive' : result < 0 ? 'negative' : undefined}>
                {format.signedMoney(result, currency)}
              </span>
            ),
          }
        : {})}
      {...(onOpen ? { onClick: onOpen } : {})}
    />
  );
}
