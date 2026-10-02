import type { Language } from '@pokerledger/shared';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { HashRouter, Navigate, Route, Routes } from 'react-router';

import { ApiProvider } from './api/ApiProvider';
import type { ApiClient } from './api/client';
import { createQueryClient } from './api/queryClient';
import { useMe } from './api/queries';
import { ToastProvider } from './components/Toast';
import { createI18n, languageFromCode } from './i18n';
import { ChatHomePage } from './pages/ChatHomePage';
import { CreateGamePage } from './pages/CreateGamePage';
import { GameLogPage } from './pages/game/GameLogPage';
import { GamePage } from './pages/game/GamePage';
import { ChatSettingsPage, FinishGamePage, HistoryPage, MyChatsPage } from './pages/stubs';
import { TelegramUiProvider } from './telegram/TelegramUi';

/** Switches to the profile language once it is known (I18N-02). */
function LanguageSync() {
  const { i18n } = useTranslation();
  const me = useMe();
  const language = me.data?.effectiveLanguage;
  useEffect(() => {
    if (language && i18n.language !== language) {
      void i18n.changeLanguage(language);
    }
  }, [i18n, language]);
  useEffect(() => {
    document.documentElement.lang = i18n.language;
  });
  return null;
}

export interface AppProvidersProps {
  readonly api: ApiClient;
  /** Language until the profile loads: from Telegram `language_code`. */
  readonly language: Language;
  /** Real Telegram: native MainButton/BackButton/popup; otherwise DOM stand-ins. */
  readonly nativeUi: boolean;
  readonly queryClient?: QueryClient;
  readonly children: ReactNode;
}

export function AppProviders({
  api,
  language,
  nativeUi,
  queryClient,
  children,
}: AppProvidersProps) {
  const [i18n] = useState(() => createI18n(language));
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ApiProvider client={api}>
          <TelegramUiProvider native={nativeUi}>
            <ToastProvider>
              <LanguageSync />
              {children}
            </ToastProvider>
          </TelegramUiProvider>
        </ApiProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<MyChatsPage />} />
      <Route path="/chats/:chatId" element={<ChatHomePage />} />
      <Route path="/chats/:chatId/new" element={<CreateGamePage />} />
      <Route path="/chats/:chatId/settings" element={<ChatSettingsPage />} />
      <Route path="/chats/:chatId/history" element={<HistoryPage />} />
      <Route path="/games/:gameId" element={<GamePage />} />
      <Route path="/games/:gameId/log" element={<GameLogPage />} />
      <Route path="/games/:gameId/finish" element={<FinishGamePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App(props: Omit<AppProvidersProps, 'children'>) {
  return (
    <AppProviders {...props}>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AppProviders>
  );
}

/** Opened outside Telegram (and not in the dev mock). */
export function NotInTelegram() {
  const [i18n] = useState(() => createI18n(languageFromCode(navigator.language)));
  return (
    <main className="page">
      <p className="status">{i18n.t('common.notInTelegram')}</p>
    </main>
  );
}
