import { useTranslation } from 'react-i18next';

import { BackButton } from '../telegram/TelegramUi';

/** A screen of a later stage. */
export function Stub({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <main className="page">
      <BackButton />
      <h1 className="page-title">{title}</h1>
      <p className="hint">{t('common.comingSoon')}</p>
    </main>
  );
}
