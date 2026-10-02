import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useErrorText } from '../i18n/hooks';

export function Spinner() {
  const { t } = useTranslation();
  return (
    <p className="status" role="status">
      {t('common.loading')}
    </p>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  return (
    <div className="status status-error" role="alert">
      <p>{errorText(error)}</p>
      {onRetry ? (
        <button type="button" className="button" onClick={onRetry}>
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  );
}

/** Loading and error states of a query; renders `children` with the data. */
export function QueryView<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  if (query.data !== undefined) return children(query.data);
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  return <Spinner />;
}
