'use client';

import type { ApiError } from '../../lib/api';

export function LoadMore({
  shown,
  total,
  loading,
  error,
  onLoad,
  onRetry,
}: {
  shown: number;
  total: number;
  loading: boolean;
  error?: ApiError;
  onLoad: () => void;
  onRetry: () => void;
}) {
  if (!total || (shown >= total && !error)) return null;
  return (
    <div className="list-more">
      <span aria-live="polite">
        {shown} de {total} registros
      </span>
      {error ? (
        <div role="alert">
          {error.message}{' '}
          <button type="button" className="secondary" onClick={onRetry}>
            Tentar novamente
          </button>
        </div>
      ) : (
        <button type="button" className="secondary" disabled={loading} onClick={onLoad}>
          {loading ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  );
}
