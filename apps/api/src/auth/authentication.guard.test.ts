import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getClaims: vi.fn(), getUser: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth }),
}));

import { AuthenticationGuard } from './authentication.guard';

describe('AuthenticationGuard', () => {
  it('valida claims e resolve o ator sem consultar getUser remotamente', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: 'profile-a' } }, error: null });
    const request = { headers: { authorization: 'Bearer valid-token' } } as Record<string, unknown>;
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };
    const prisma = {
      organizationMember: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'membership-a',
            organizationId: 'organization-a',
            userId: 'user-a',
            clientId: null,
            roles: [
              {
                role: {
                  permissions: [
                    { permission: { resource: 'clients', action: 'view' } },
                    { permission: { resource: 'clients', action: 'view' } },
                  ],
                },
              },
            ],
          },
        ]),
      },
    };
    const config = {
      get: vi.fn((key: string) =>
        key === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'anon',
      ),
    };
    const guard = new AuthenticationGuard(reflector as never, config as never, prisma as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.getClaims).toHaveBeenCalledWith('valid-token');
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(request.actor).toEqual(
      expect.objectContaining({
        profileId: 'profile-a',
        organizationId: 'organization-a',
        permissions: ['clients:view'],
      }),
    );
  });
});
