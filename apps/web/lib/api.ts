'use client';

import { createSupabaseBrowserClient } from './supabase/client';

const baseUrl = process.env.NEXT_PUBLIC_API_URL!;
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
type InFlightRead = {
  promise: Promise<unknown>;
  controller: AbortController;
  subscribers: number;
  done: boolean;
};
const inFlightReads = new Map<string, InFlightRead>();
const CACHE_TTL_MS = 15_000;
const MAX_CACHE_ENTRIES = 80;
const nonInvalidatingWritePaths = new Set(['/audit-logs/module-views', '/audit-logs/client-views']);
let readVersion = 0;

function invalidateReads(abortInFlight = false) {
  readVersion += 1;
  responseCache.clear();
  if (abortInFlight) {
    for (const entry of inFlightReads.values()) entry.controller.abort();
  }
  inFlightReads.clear();
}

function rememberRead(key: string, value: unknown) {
  responseCache.delete(key);
  responseCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  if (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest) responseCache.delete(oldest);
  }
}

function subscribeToRead<T>(entry: InFlightRead, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted)
    return Promise.reject(new DOMException('Requisição cancelada', 'AbortError'));
  entry.subscribers += 1;
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const finish = () => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      entry.subscribers -= 1;
      if (!entry.done && entry.subscribers === 0) entry.controller.abort();
      return true;
    };
    const onAbort = () => {
      if (finish()) reject(new DOMException('Requisição cancelada', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    entry.promise.then(
      (value) => {
        if (finish()) resolve(value as T);
      },
      (error: unknown) => {
        if (finish()) reject(error);
      },
    );
  });
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function request(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
  accessToken?: string | null,
) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const token =
    accessToken === undefined
      ? (await createSupabaseBrowserClient().auth.getSession()).data.session?.access_token
      : accessToken;
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const selectedOrganization = window.localStorage.getItem('livio:organization-id');
  if (selectedOrganization) headers.set('X-Organization-Id', selectedOrganization);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Falha de rede. Verifique sua conexão e tente novamente.');
  }
  return response;
}

async function responseError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
  return new ApiError(response.status, body.message ?? 'A operação não foi concluída.', body.code);
}

async function sendAndParse<T>(
  path: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  accessToken: string | null,
): Promise<T> {
  const response = await request(path, init, signal, accessToken);
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string } & T;
  if (!response.ok) {
    throw new ApiError(response.status, body.message ?? 'A operação não foi concluída.', body.code);
  }
  return body;
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const method = init.method?.toUpperCase() ?? 'GET';
  const invalidatesReadCache =
    method !== 'GET' && !nonInvalidatingWritePaths.has(path.split('?')[0] ?? path);
  const { data: sessionData } = await createSupabaseBrowserClient().auth.getSession();
  const accessToken = sessionData.session?.access_token ?? null;
  const cacheKey = `${accessToken ?? 'anonymous'}:${window.localStorage.getItem('livio:organization-id') ?? 'default'}:${path}`;
  const cacheable = method === 'GET' && path !== '/auth/me' && !init.headers && !init.body;
  if (signal?.aborted) throw new DOMException('Requisição cancelada', 'AbortError');
  if (cacheable) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      responseCache.delete(cacheKey);
      responseCache.set(cacheKey, cached);
      return cached.value as T;
    }
    if (cached) responseCache.delete(cacheKey);

    let entry = inFlightReads.get(cacheKey);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      const version = readVersion;
      entry = { controller, subscribers: 0, done: false, promise: Promise.resolve() };
      const current = entry;
      current.promise = sendAndParse<T>(path, init, controller.signal, accessToken)
        .then((body) => {
          if (!controller.signal.aborted && version === readVersion) rememberRead(cacheKey, body);
          return body;
        })
        .finally(() => {
          current.done = true;
          if (inFlightReads.get(cacheKey) === current) inFlightReads.delete(cacheKey);
        });
      inFlightReads.set(cacheKey, current);
    }
    return subscribeToRead<T>(entry, signal);
  }

  if (invalidatesReadCache) invalidateReads();
  const body = await sendAndParse<T>(path, init, signal, accessToken);
  if (invalidatesReadCache) invalidateReads();
  return body;
}

export async function downloadApiFile(path: string, fileName: string): Promise<void> {
  const response = await request(path);
  if (!response.ok) throw await responseError(response);

  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.rel = 'noopener';
    link.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function resetApiSession() {
  invalidateReads(true);
  window.localStorage.removeItem('livio:organization-id');
  await createSupabaseBrowserClient().auth.signOut();
}
