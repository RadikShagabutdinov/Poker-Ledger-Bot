// «My chats»: the start screen when the app is opened from the private chat with the bot.
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { useMyChats } from '../api/queries';
import { ListItem, Section } from '../components/List';
import { QueryView } from '../components/Status';

export function MyChatsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const chats = useMyChats();
  return (
    <main className="page">
      <header className="game-header">
        <h1 className="page-title">{t('myChats.title')}</h1>
        <Link className="hint-link" to="/profile">
          {t('profile.title')}
        </Link>
      </header>
      <QueryView query={chats}>
        {(data) =>
          data.chats.length === 0 ? (
            <p className="hint">{t('myChats.empty')}</p>
          ) : (
            <Section>
              {data.chats.map((chat) => (
                <ListItem
                  key={chat.chatId}
                  title={chat.title}
                  {...(chat.activeGameIds.length > 0
                    ? { after: <span className="badge">{t('myChats.activeGame')}</span> }
                    : {})}
                  onClick={() => void navigate(`/chats/${chat.chatId}`)}
                />
              ))}
            </Section>
          )
        }
      </QueryView>
    </main>
  );
}
