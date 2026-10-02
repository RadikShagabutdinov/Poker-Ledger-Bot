import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App, NotInTelegram } from './App';
import { createApiClient } from './api/client';
import { languageFromCode } from './i18n';
import { applyStartParam } from './routing/startParam';
import { bootstrapTelegram, readLaunchContext } from './telegram/bootstrap';
import './styles.css';

async function start() {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Root element #root not found');
  const root = createRoot(rootElement);

  // The browser mock is only part of the dev build.
  let mocked = false;
  if (import.meta.env.DEV) {
    const { mockTelegramIfNeeded } = await import('./telegram/mock');
    mocked = mockTelegramIfNeeded();
  }

  const launch = readLaunchContext();
  if (!launch) {
    root.render(<NotInTelegram />);
    return;
  }
  bootstrapTelegram();
  applyStartParam(launch.startParam, window.location);
  const api = createApiClient({
    baseUrl: import.meta.env.VITE_API_URL || '/api',
    initDataRaw: launch.initDataRaw,
  });
  root.render(
    <StrictMode>
      <App api={api} language={languageFromCode(launch.languageCode)} nativeUi={!mocked} />
    </StrictMode>,
  );
}

void start();
