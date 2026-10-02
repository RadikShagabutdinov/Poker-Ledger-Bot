// Chat home (SPEC §12.3): the active game or «New game», the last 5 games, links.
import { chipsToMoneyRounded } from '@pokerledger/core';
import type { HistoryPageResponse } from '@pokerledger/shared';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { useChat, useChatGames } from '../api/queries';
import { ListItem, Section } from '../components/List';
import { QueryView } from '../components/Status';
import { useFormat } from '../i18n/hooks';
import { BackButton, MainButton } from '../telegram/TelegramUi';

const RECENT_GAMES = 5;

type GameItem = HistoryPageResponse['items'][number];

export function ChatHomePage() {
  const { chatId = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const chat = useChat(chatId);
  const active = useChatGames(chatId, { status: 'active' });
  const recent = useChatGames(chatId);

  const activeGame = active.data?.items[0];

  return (
    <main className="page">
      <BackButton />
      <QueryView query={chat}>{(data) => <h1 className="page-title">{data.title}</h1>}</QueryView>

      <QueryView query={active}>
        {() =>
          activeGame ? (
            <Section title={t('chat.activeGame')}>
              <GameRow game={activeGame} onOpen={() => void navigate(`/games/${activeGame.id}`)} />
            </Section>
          ) : (
            <MainButton
              text={t('chat.newGame')}
              onClick={() => void navigate(`/chats/${chatId}/new`)}
            />
          )
        }
      </QueryView>

      <Section title={t('chat.recentGames')}>
        <QueryView query={recent}>
          {(data) =>
            data.items.length === 0 ? (
              <p className="hint">{t('chat.noGames')}</p>
            ) : (
              data.items
                .slice(0, RECENT_GAMES)
                .map((game) => (
                  <GameRow
                    key={game.id}
                    game={game}
                    onOpen={() => void navigate(`/games/${game.id}`)}
                  />
                ))
            )
          }
        </QueryView>
      </Section>

      <nav className="links">
        <Link to={`/chats/${chatId}/history`}>{t('chat.allHistory')}</Link>
        <Link to={`/chats/${chatId}/settings`}>{t('chat.settings')}</Link>
      </nav>
    </main>
  );
}

function GameRow({ game, onOpen }: { game: GameItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const format = useFormat();
  const date = new Intl.DateTimeFormat(format.language === 'ru' ? 'ru-RU' : 'en-US', {
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
