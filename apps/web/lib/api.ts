'use client';

import { createSupabaseBrowserClient } from './supabase/client';

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  if (data.session?.access_token) {
    headers.set('Authorization', `Bearer ${data.session.access_token}`);
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
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string } & T;
  if (!response.ok) {
    throw new ApiError(response.status, body.message ?? 'A operação não foi concluída.', body.code);
  }
  return body;
}

export async function resetApiSession() {
  window.localStorage.removeItem('livio:organization-id');
  await createSupabaseBrowserClient().auth.signOut();
}
