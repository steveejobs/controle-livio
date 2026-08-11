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
