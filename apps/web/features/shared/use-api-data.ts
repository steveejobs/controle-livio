'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';

export function useApiData<T>(path?: string, debounce = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    if (!path) {
      setData(undefined);
      return undefined;
    }
    const controller = new AbortController();
    setError(undefined);
    const timer = window.setTimeout(() => {
      api<T>(path, {}, controller.signal)
        .then(setData)
        .catch((caught: unknown) => {
          if (!(caught instanceof DOMException) && caught instanceof ApiError) setError(caught);
        });
    }, debounce);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [path, debounce, version]);

  return { data, error, reload, setData };
}
