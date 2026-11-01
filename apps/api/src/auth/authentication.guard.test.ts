import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getClaims: vi.fn(), getUser: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth }),
}));

import { AuthenticationGuard } from './authentication.guard';

function contextFor(token: string, organizationId: string): ExecutionContext {
  const request = {
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': organizationId,
    },
  } as Record<string, unknown>;
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function membership(organizationId: string, userId = 'user-a') {
  return {
    id: `membership-${organizationId}-${userId}`,
    organizationId,
    userId,
    clientId: null,
    roles: [
      {
        role: {
          key: 'administrator',
          permissions: [{ permission: { resource: 'clients', action: 'view' } }],
        },
      },
    ],
  };
}

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

  it('compartilha uma consulta de membership somente enquanto requisições do mesmo escopo concorrem', async () => {
    auth.getClaims.mockImplementation((token: string) =>
      Promise.resolve({ data: { claims: { sub: 'profile-a', session_id: token } }, error: null }),
    );
    let resolveLookup!: (value: ReturnType<typeof membership>[]) => void;
    const pendingLookup = new Promise<ReturnType<typeof membership>[]>((resolve) => {
      resolveLookup = resolve;
    });
    const findMany = vi
      .fn()
      .mockReturnValueOnce(pendingLookup)
      .mockResolvedValue([membership('org-a')]);
    const prisma = { organizationMember: { findMany } };
    const config = {
      get: vi.fn((key: string) =>
        key === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'anon',
      ),
    };
    const guard = new AuthenticationGuard(
      { getAllAndOverride: vi.fn().mockReturnValue(false) } as never,
      config as never,
      prisma as never,
    );

    const first = guard.canActivate(contextFor('token-a', 'org-a'));
    const second = guard.canActivate(contextFor('token-b', 'org-a'));
    await vi.waitFor(() => expect(findMany).toHaveBeenCalledOnce());
    resolveLookup([membership('org-a')]);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(findMany).toHaveBeenCalledOnce();

    await expect(guard.canActivate(contextFor('token-c', 'org-a'))).resolves.toBe(true);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('não compartilha membership entre organizações diferentes', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: 'profile-a' } }, error: null });
    const findMany = vi.fn(({ where }: { where: { organizationId: string } }) =>
      Promise.resolve([membership(where.organizationId)]),
    );
    const prisma = { organizationMember: { findMany } };
    const config = {
      get: vi.fn((key: string) =>
        key === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'anon',
      ),
    };
    const guard = new AuthenticationGuard(
      { getAllAndOverride: vi.fn().mockReturnValue(false) } as never,
      config as never,
      prisma as never,
    );
    const first = contextFor('token-a', 'org-a');
    const second = contextFor('token-b', 'org-b');

    await expect(
      Promise.all([guard.canActivate(first), guard.canActivate(second)]),
    ).resolves.toEqual([true, true]);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0]?.[0].where.organizationId).toBe('org-a');
    expect(findMany.mock.calls[1]?.[0].where.organizationId).toBe('org-b');
  });

  it('isolates users and reloads a revoked membership', async () => {
    auth.getClaims.mockImplementation((token: string) =>
      Promise.resolve({ data: { claims: { sub: token } }, error: null }),
    );
    const findMany = vi.fn(({ where }: { where: { profileId: string } }) =>
      Promise.resolve([membership('org-a', where.profileId)]),
    );
    const config = {
      get: vi.fn((key: string) =>
        key === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'anon',
      ),
    };
    const guard = new AuthenticationGuard(
      { getAllAndOverride: vi.fn().mockReturnValue(false) } as never,
      config as never,
      { organizationMember: { findMany } } as never,
    );
    const first = contextFor('profile-a', 'org-a');
    const second = contextFor('profile-b', 'org-a');

    await expect(
      Promise.all([guard.canActivate(first), guard.canActivate(second)]),
    ).resolves.toEqual([true, true]);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls.map(([query]) => query.where.profileId)).toEqual([
      'profile-a',
      'profile-b',
    ]);
    expect((first.switchToHttp().getRequest() as { actor: { userId: string } }).actor.userId).toBe(
      'profile-a',
    );
    expect((second.switchToHttp().getRequest() as { actor: { userId: string } }).actor.userId).toBe(
      'profile-b',
    );

    findMany.mockResolvedValueOnce([]);
    await expect(guard.canActivate(contextFor('profile-a', 'org-a'))).rejects.toMatchObject({
      status: 401,
    });
    expect(findMany).toHaveBeenCalledTimes(3);
  });

  it('removes a rejected lookup so the next request retries', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: 'profile-a' } }, error: null });
    const findMany = vi
      .fn()
      .mockRejectedValueOnce(new Error('Connection failed'))
      .mockResolvedValueOnce([membership('org-a')]);
    const config = {
      get: vi.fn((key: string) =>
        key === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'anon',
      ),
    };
    const guard = new AuthenticationGuard(
      { getAllAndOverride: vi.fn().mockReturnValue(false) } as never,
      config as never,
      { organizationMember: { findMany } } as never,
    );

    await expect(guard.canActivate(contextFor('token-a', 'org-a'))).rejects.toThrow(
      'Connection failed',
    );
    await expect(guard.canActivate(contextFor('token-a', 'org-a'))).resolves.toBe(true);
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
