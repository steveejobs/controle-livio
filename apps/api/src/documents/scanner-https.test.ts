import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanHttps } from './scanner-https';

afterEach(() => vi.unstubAllGlobals());
describe('HTTPS scanner contract', () => {
  it.each(['clean', 'infected', 'unknown', null])('handles verdict %s', async (verdict) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ verdict }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const scan = scanHttps(
      Buffer.from('synthetic'),
      'https://scanner.example/scan',
      'x'.repeat(32),
      500,
    );
    if (verdict === 'clean') await expect(scan).resolves.toBeUndefined();
    else await expect(scan).rejects.toMatchObject({ status: verdict === 'infected' ? 422 : 503 });
  });
  it.each([401, 302, 500])('rejects HTTP %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    await expect(
      scanHttps(Buffer.from('test'), 'https://scanner.example', 'x'.repeat(32), 500),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('fails closed without leaking transport errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret')));
    await expect(
      scanHttps(Buffer.from('test'), 'https://scanner.example', 'x'.repeat(32), 500),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('rejects oversized responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('x'.repeat(1025), { headers: { 'content-type': 'application/json' } }),
        ),
    );
    await expect(
      scanHttps(Buffer.from('test'), 'https://scanner.example', 'x'.repeat(32), 500),
    ).rejects.toMatchObject({ status: 503 });
  });
});
