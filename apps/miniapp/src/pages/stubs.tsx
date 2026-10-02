import { useTranslation } from 'react-i18next';

import { Stub } from '../components/Stub';

// Screens of stages 6–7.
export function MyChatsPage() {
  const { t } = useTranslation();
  return <Stub title={t('myChats.title')} />;
}

export function ChatSettingsPage() {
  const { t } = useTranslation();
  return <Stub title={t('chat.settings')} />;
}

export function HistoryPage() {
  const { t } = useTranslation();
  return <Stub title={t('chat.allHistory')} />;
}

export function FinishGamePage() {
  const { t } = useTranslation();
  return <Stub title={t('game.finish')} />;
}
