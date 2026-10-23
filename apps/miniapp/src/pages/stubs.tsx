import { useTranslation } from 'react-i18next';

import { Stub } from '../components/Stub';

// Screens that are not built yet.
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
