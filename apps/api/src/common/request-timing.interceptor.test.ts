import type { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { RequestTimingInterceptor } from './request-timing.interceptor';

describe('QA request timing header', () => {
  it('reports auth, membership, rate limit, permission, and handler stages only when enabled', async () => {
    const previous = process.env.QA_TIMINGS;
    process.env.QA_TIMINGS = 'true';
    try {
      const setHeader = vi.fn();
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            qaTimings: {
              authClaims: 2.5,
              membershipPrismaRoundtrip: 3.1,
              rateLimitPrismaRoundtrip: 1.7,
              permissionGuard: 0.1,
            },
          }),
          getResponse: () => ({ setHeader }),
        }),
      } as unknown as ExecutionContext;
      const interceptor = new RequestTimingInterceptor();

      await lastValueFrom(interceptor.intercept(context, { handle: () => of({ ok: true }) }));

      expect(setHeader).toHaveBeenCalledWith(
        'Server-Timing',
        expect.stringMatching(
          /authClaims;dur=2\.5, membershipPrismaRoundtrip;dur=3\.1, rateLimitPrismaRoundtrip;dur=1\.7, permissionGuard;dur=0\.1, handler;dur=/,
        ),
      );
    } finally {
      if (previous === undefined) delete process.env.QA_TIMINGS;
      else process.env.QA_TIMINGS = previous;
    }
  });
});
