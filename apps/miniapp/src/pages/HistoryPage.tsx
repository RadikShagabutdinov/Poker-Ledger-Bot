// Game history of a chat: period filter, cards, infinite scroll by cursor.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { useChatHistory } from '../api/queries';
import { GameCard } from '../components/GameCard';
import { Section } from '../components/List';
import { ErrorState, Spinner } from '../components/Status';
import { BackButton } from '../telegram/TelegramUi';

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIODS = { '30d': 30, '365d': 365, all: null } as const;
type Period = keyof typeof PERIODS;

function isPeriod(value: string | null): value is Period {
  return value !== null && value in PERIODS;
}

export function HistoryPage() {
  const { chatId = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get('period');
  const period: Period = isPeriod(raw) ? raw : 'all';

  // Fixed on mount, so the query key does not change on every render.
  const [now] = useState(() => Date.now());
  const days = PERIODS[period];
  const from = days === null ? undefined : now - days * DAY_MS;
  const history = useChatHistory(chatId, from);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = history;

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = history.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <main className="page">
      <BackButton />
      <h1 className="page-title">{t('history.title')}</h1>

      <div className="tabs" role="tablist" aria-label={t('history.period')}>
        {(Object.keys(PERIODS) as Period[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            className="tab"
            aria-selected={period === value}
            onClick={() => {
              setParams(value === 'all' ? {} : { period: value }, { replace: true });
            }}
          >
            {t(`history.periods.${value}`)}
          </button>
        ))}
      </div>

      {history.data === undefined ? (
        history.isError ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : (
          <Spinner />
        )
      ) : items.length === 0 ? (
        <p className="hint">{t('history.empty')}</p>
      ) : (
        <Section>
          {items.map((game) => (
            <GameCard key={game.id} game={game} onOpen={() => void navigate(`/games/${game.id}`)} />
          ))}
        </Section>
      )}

      {hasNextPage ? (
        <div ref={sentinel}>
          <button
            type="button"
            className="button button-wide"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage ? t('common.loading') : t('history.more')}
          </button>
        </div>
      ) : null}
      {history.isFetchNextPageError ? <ErrorState error={history.error} /> : null}
    </main>
  );
}
