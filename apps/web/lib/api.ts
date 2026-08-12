'use client';

import { createSupabaseBrowserClient } from './supabase/client';

const baseUrl = process.env.NEXT_PUBLIC_API_URL!;
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const CACHE_TTL_MS = 15_000;

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

export async function api<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const method = init.method?.toUpperCase() ?? 'GET';
  const { data: sessionData } = await createSupabaseBrowserClient().auth.getSession();
  const accessToken = sessionData.session?.access_token ?? null;
  const cacheKey = `${accessToken ?? 'anonymous'}:${window.localStorage.getItem('livio:organization-id') ?? 'default'}:${path}`;
  if (method === 'GET' && path !== '/auth/me') {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  } else if (method !== 'GET') {
    responseCache.clear();
  }
  const response = await request(path, init, signal, accessToken);
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string } & T;
  if (!response.ok) {
    throw new ApiError(response.status, body.message ?? 'A operação não foi concluída.', body.code);
  }
  if (method === 'GET' && path !== '/auth/me') {
    responseCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: body });
  }
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
  responseCache.clear();
  window.localStorage.removeItem('livio:organization-id');
  await createSupabaseBrowserClient().auth.signOut();
}
