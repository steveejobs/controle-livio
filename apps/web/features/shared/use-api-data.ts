'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';

export function useApiData<T>(path?: string, debounce = 0) {
  const [result, setResult] = useState<{ path: string; value: T }>();
  const [requestError, setRequestError] = useState<{ path: string; value: ApiError }>();
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const setData = useCallback(
    (value: T | undefined) => setResult(value === undefined || !path ? undefined : { path, value }),
    [path],
  );

  useEffect(() => {
    if (!path) {
      setResult(undefined);
      return undefined;
    }
    const controller = new AbortController();
    setRequestError(undefined);
    const timer = window.setTimeout(() => {
      api<T>(path, {}, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setResult({ path, value });
        })
        .catch((caught: unknown) => {
          if (!controller.signal.aborted && caught instanceof ApiError)
            setRequestError({ path, value: caught });
        });
    }, debounce);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [path, debounce, version]);

  return {
    data: result && result.path === path ? result.value : undefined,
    error: requestError && requestError.path === path ? requestError.value : undefined,
    reload,
    setData,
  };
}
