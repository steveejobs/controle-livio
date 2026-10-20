'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';

type Page<T> = { items: T[]; total: number };
type RequestState = { path?: string; page: number; version: number };

export function usePaginatedData<T extends { id: string }>(path?: string, pageSize = 25) {
  const [request, setRequest] = useState<RequestState>({ path, page: 1, version: 0 });
  const [result, setResult] = useState<Page<T> & { path: string }>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRequest((current) =>
      current.path === path ? current : { path, page: 1, version: current.version + 1 },
    );
    setResult(undefined);
    setError(undefined);
  }, [path]);

  useEffect(() => {
    if (!path || request.path !== path) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(undefined);
    const separator = path.includes('?') ? '&' : '?';
    void api<Page<T>>(
      `${path}${separator}page=${request.page}&pageSize=${pageSize}`,
      {},
      controller.signal,
    )
      .then((response) => {
        if (!active) return;
        setResult((previous) => {
          if (request.page === 1 || previous?.path !== path) return { ...response, path };
          const items = new Map(previous.items.map((item) => [item.id, item]));
          for (const item of response.items) items.set(item.id, item);
          return { items: [...items.values()], total: response.total, path };
        });
      })
      .catch((caught: unknown) => {
        if (active && caught instanceof ApiError) setError(caught);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [path, pageSize, request]);

  const data = result?.path === path ? result : undefined;
  const reload = useCallback(() => {
    setResult(undefined);
    setRequest((current) => ({ ...current, page: 1, version: current.version + 1 }));
  }, []);
  const loadMore = useCallback(() => {
    if (!data || loading || data.items.length >= data.total) return;
    setRequest((current) => ({ ...current, page: current.page + 1 }));
  }, [data, loading]);
  const retry = useCallback(() => {
    setRequest((current) => ({ ...current, version: current.version + 1 }));
  }, []);

  return { data, error, loading, loadMore, reload, retry };
}
