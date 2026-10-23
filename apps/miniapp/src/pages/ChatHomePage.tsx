// Chat home: the active game or «New game», the last 5 games, links.
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { useChat, useChatGames } from '../api/queries';
import { GameCard } from '../components/GameCard';
import { Section } from '../components/List';
import { QueryView } from '../components/Status';
import { BackButton, MainButton } from '../telegram/TelegramUi';

const RECENT_GAMES = 5;

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
              <GameCard game={activeGame} onOpen={() => void navigate(`/games/${activeGame.id}`)} />
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
                  <GameCard
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
        <Link to="/profile">{t('profile.title')}</Link>
      </nav>
    </main>
  );
}
