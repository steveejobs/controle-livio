import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('./supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth }),
}));

describe('authenticated API client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test/v1';
    auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'access-token-for-test' } },
    });
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn(() => 'organization-for-test'),
        removeItem: vi.fn(),
      },
    });
  });

  it('sends the access token and selected organization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api');

    await expect(api('/clients')).resolves.toEqual({ items: [] });
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer access-token-for-test');
    expect(headers.get('X-Organization-Id')).toBe('organization-for-test');
  });

  it('reaproveita leituras brevemente e invalida o cache após uma escrita', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api');

    await api('/clients');
    await api('/clients');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await api('/clients', { method: 'POST', body: JSON.stringify({ name: 'Novo' }) });
    await api('/clients');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('compartilha leituras simultâneas sem cancelar os outros consumidores', async () => {
    let complete!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api');
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = api('/clients', {}, firstController.signal);
    const second = api('/clients', {}, secondController.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock.mock.calls[0]?.[1]?.signal.aborted).toBe(false);

    complete(new Response(JSON.stringify({ items: [{ id: 'client-a' }] }), { status: 200 }));
    await expect(second).resolves.toEqual({ items: [{ id: 'client-a' }] });
    await expect(api('/clients')).resolves.toEqual({ items: [{ id: 'client-a' }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('não reutiliza uma leitura iniciada antes de uma escrita', async () => {
    let finishOldRead!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      if (init.method === 'POST') return Promise.resolve(new Response('{}', { status: 200 }));
      if (fetchMock.mock.calls.length === 1) {
        return new Promise<Response>((resolve) => {
          finishOldRead = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ items: ['atual'] }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api');

    const oldRead = api('/clients');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await api('/clients', { method: 'POST', body: '{}' });
    await expect(api('/clients')).resolves.toEqual({ items: ['atual'] });
    finishOldRead(new Response(JSON.stringify({ items: ['antigo'] }), { status: 200 }));
    await expect(oldRead).resolves.toEqual({ items: ['antigo'] });
    await expect(api('/clients')).resolves.toEqual({ items: ['atual'] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('cancela o transporte quando todos os leitores saem e permite nova tentativa', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      if (fetchMock.mock.calls.length > 1) {
        return Promise.resolve(new Response(JSON.stringify({ items: ['novo'] }), { status: 200 }));
      }
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Requisição cancelada', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api');
    const controller = new AbortController();

    const pending = api('/clients', {}, controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
    await expect(api('/clients')).resolves.toEqual({ items: ['novo'] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('downloads a protected CSV through the authenticated client', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('\uFEFFname\r\nGabriel', {
        status: 200,
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      }),
    );
    const click = vi.fn();
    const link = { href: '', download: '', rel: '', click };
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('document', { createElement: vi.fn(() => link) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { downloadApiFile } = await import('./api');

    await downloadApiFile('/reports/aging/export.csv', 'livio-aging.csv');

    expect(click).toHaveBeenCalledOnce();
    expect(link.download).toBe('livio-aging.csv');
    expect(revoke).toHaveBeenCalledWith('blob:report');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer access-token-for-test');
  });
});
