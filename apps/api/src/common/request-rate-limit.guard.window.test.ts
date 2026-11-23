import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RequestRateLimitGuard } from './request-rate-limit.guard';

describe('fixed minute rate limit window', () => {
  it('allows remaining quota to rise when PostgreSQL starts a new window', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ request_count: 60, retry_after: 1 }])
      .mockResolvedValueOnce([{ request_count: 1, retry_after: 59 }]);
    const setHeader = vi.fn();
    const guard = new RequestRateLimitGuard(
      { $queryRaw: query } as never,
      { get: vi.fn(() => 300) } as never,
    );
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', actor: { userId: 'user-a', organizationId: 'org-a' } }),
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(setHeader).toHaveBeenNthCalledWith(2, 'X-RateLimit-Remaining', 240);
    expect(setHeader).toHaveBeenNthCalledWith(4, 'X-RateLimit-Remaining', 299);
    const sql = (query.mock.calls[0]?.[0] as TemplateStringsArray).join(' ');
    expect(sql).toContain("date_trunc('minute', CURRENT_TIMESTAMP)");
    expect(sql).toContain('ELSE 1 END');
  });
});
