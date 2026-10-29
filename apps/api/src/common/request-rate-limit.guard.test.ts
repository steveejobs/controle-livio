import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RequestRateLimitGuard } from './request-rate-limit.guard';

function fixture(count: number, method = 'GET', authenticated = true) {
  const query = vi.fn().mockResolvedValue([{ request_count: count, retry_after: 35 }]);
  const config = { get: vi.fn((key) => (key === 'API_RATE_LIMIT_READ' ? 300 : 60)) };
  const setHeader = vi.fn();
  const request = {
    method,
    ...(authenticated ? { actor: { userId: 'user-a', organizationId: 'org-a' } } : {}),
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader }) }),
  } as unknown as ExecutionContext;
  return {
    guard: new RequestRateLimitGuard({ $queryRaw: query } as never, config as never),
    query,
    config,
    context,
    setHeader,
  };
}

describe('limites compartilhados da API', () => {
  it('usa o banco atomicamente e identifica usuário/organização sem armazenar IP ou token', async () => {
    const { guard, context, query, setHeader } = fixture(2);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 298);
    const values = query.mock.calls[0]!.slice(1);
    expect(values).toEqual(['org-a', expect.stringMatching(/^[a-f0-9]{64}$/)]);
  });

  it('devolve 429 e informa quando tentar novamente após exceder escritas', async () => {
    const { guard, context, config, setHeader } = fixture(61, 'POST');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 429 });
    expect(config.get).toHaveBeenCalledWith('API_RATE_LIMIT_WRITE', { infer: true });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', 35);
  });

  it('mantém health checks e crons públicos fora da quota autenticada', async () => {
    const { guard, context, query } = fixture(1, 'GET', false);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
});
