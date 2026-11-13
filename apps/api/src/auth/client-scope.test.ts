import type { ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialRolePermissions } from '@livio/shared';

const auth = vi.hoisted(() => ({ getClaims: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth }) }));
import { AuthenticationGuard } from './authentication.guard';
import { AdminService } from '../admin/admin.service';
import { AuthController } from './auth.controller';

const org = '10000000-0000-4000-8000-000000000001';
const clientId = '11000000-0000-4000-8000-000000000001';
function membership(keys: string[], binding: string | null = clientId, clientOrg = org) {
  return {
    id: 'member',
    organizationId: org,
    userId: 'user',
    clientId: binding,
    client: binding ? { id: binding, organizationId: clientOrg, deletedAt: null } : null,
    roles: keys.map((key) => ({
      organizationId: org,
      role: {
        key,
        organizationId: org,
        permissions: (
          initialRolePermissions[key as keyof typeof initialRolePermissions] ?? ['clients:view']
        ).map((code) => {
          const [resource, action] = code.split(':');
          return { permission: { resource, action } };
        }),
      },
    })),
  };
}
function fixture(rows: ReturnType<typeof membership>[]) {
  const request: Record<string, unknown> = {
    headers: { authorization: 'Bearer old-valid-token', 'x-organization-id': org },
  };
  const context = {
    getHandler: () => () => {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const findMany = vi.fn().mockResolvedValue(rows);
  const guard = new AuthenticationGuard(
    { getAllAndOverride: () => false } as never,
    {
      get: (key: string) => (key === 'SUPABASE_URL' ? 'http://127.0.0.1:54321' : 'synthetic'),
    } as never,
    { organizationMember: { findMany } } as never,
  );
  return { request, context, findMany, guard };
}

beforeEach(() => {
  auth.getClaims.mockResolvedValue({ data: { claims: { sub: 'profile' } }, error: null });
});
describe('DEF018 client scope admission', () => {
  it('reports the effective scope to the UI instead of a personal staff binding', async () => {
    const controller = new AuthController({
      organizationMember: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'member',
          clientId,
          profile: { fullName: 'Synthetic', email: 'synthetic@example.test' },
          organization: { id: org, legalName: 'Synthetic', tradeName: null, slug: 'synthetic' },
        }),
      },
    } as never);
    const staff = {
      membershipId: 'member',
      profileId: 'profile',
      organizationId: org,
      userId: 'user',
      permissions: [],
    };
    expect((await controller.me(staff)).user.clientId).toBeNull();
    expect((await controller.me({ ...staff, clientId })).user.clientId).toBe(clientId);
  });
  it('keeps a valid bound client scoped', async () => {
    const f = fixture([membership(['client'])]);
    await expect(f.guard.canActivate(f.context)).resolves.toBe(true);
    expect(f.request.actor).toMatchObject({ clientId, isAdministrator: false });
  });
  it.each([
    ['unbound', membership(['client'], null)],
    ['foreign binding', membership(['client'], clientId, 'other-org')],
    ['unbound with custom role', membership(['client', 'custom'], null)],
    ['no roles', membership([], null)],
    ['missing client relation', { ...membership(['client']), client: null }],
    [
      'deleted client',
      {
        ...membership(['client']),
        client: { id: clientId, organizationId: org, deletedAt: new Date() },
      },
    ],
  ])('denies %s before attaching an actor', async (_label, row) => {
    const f = fixture([row as ReturnType<typeof membership>]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({ status: 401 });
    expect(f.request.actor).toBeUndefined();
  });
  it.each([['lawyer'], ['client', 'lawyer'], ['client', 'finance'], ['administrator'], ['custom']])(
    'preserves explicitly assigned staff roles %j',
    async (...keys) => {
      const f = fixture([membership(keys, null)]);
      await expect(f.guard.canActivate(f.context)).resolves.toBe(true);
      expect(f.request.actor).not.toHaveProperty('clientId');
    },
  );
  it('does not narrow a professional with an additional client role and valid personal binding', async () => {
    const f = fixture([membership(['client', 'lawyer'])]);
    await expect(f.guard.canActivate(f.context)).resolves.toBe(true);
    expect(f.request.actor).not.toHaveProperty('clientId');
  });
  it('never promotes a client through a role belonging to another organization', async () => {
    const row = membership(['client', 'lawyer']);
    row.roles[1]!.role.organizationId = 'other-org';
    const f = fixture([row]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({ status: 401 });
    expect(f.request.actor).toBeUndefined();
  });
  it('does not let an old token retain a removed binding or active membership', async () => {
    const f = fixture([membership(['client'])]);
    await f.guard.canActivate(f.context);
    f.findMany.mockResolvedValueOnce([membership(['client'], null)]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({ status: 401 });
    f.findMany.mockResolvedValueOnce([]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({ status: 401 });
    expect(f.findMany).toHaveBeenCalledTimes(3);
  });
  it('queries active organization and operational user on every completed lookup', async () => {
    const f = fixture([]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({ status: 401 });
    expect(f.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          organization: { status: 'ACTIVE' },
          user: { status: 'ACTIVE', deletedAt: null },
        }),
      }),
    );
  });
});

describe('DEF018 administrator provisioning', () => {
  it.each([
    ['unbound', membership(['client'], null)],
    ['foreign', membership(['client'], clientId, 'foreign')],
    ['empty roles', membership([], null)],
  ])('does not reactivate an inconsistent membership: %s', async (_label, row) => {
    const transaction = {
      organizationMember: { findUnique: vi.fn().mockResolvedValue(row) },
      user: { update: vi.fn() },
    };
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'user' }) },
      $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(transaction)),
    };
    const service = new AdminService(prisma as never, {} as never, { record: vi.fn() } as never);
    await expect(
      service.setUserStatus({ organizationId: org } as never, 'user', { status: 'ACTIVE' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(transaction.user.update).not.toHaveBeenCalled();
  });
  it.each([['client'], ['lawyer'], ['client', 'lawyer']])(
    'allows consistent reactivation %j',
    async (...keys) => {
      const transaction = {
        organizationMember: { findUnique: vi.fn().mockResolvedValue(membership(keys)) },
        user: { update: vi.fn().mockResolvedValue({ id: 'user', status: 'ACTIVE' }) },
      };
      const prisma = {
        user: { findFirst: vi.fn().mockResolvedValue({ id: 'user' }) },
        $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(transaction)),
      };
      const audit = { record: vi.fn() };
      const service = new AdminService(prisma as never, {} as never, audit as never);
      await expect(
        service.setUserStatus({ organizationId: org } as never, 'user', { status: 'ACTIVE' }),
      ).resolves.toMatchObject({ status: 'ACTIVE' });
      expect(audit.record).toHaveBeenCalledOnce();
    },
  );
  it.each([['client'], ['lawyer'], ['client', 'lawyer'], ['client', 'custom']])(
    'retains valid provisioning before invitation %j',
    async (...keys) => {
      const invite = vi.fn().mockRejectedValue(new Error('EXPECTED_VALID_INVITATION'));
      const roles = keys.map((key, i) => ({ id: `role-${i}`, key }));
      const service = new AdminService(
        {
          role: { findMany: vi.fn().mockResolvedValue(roles) },
          client: { findFirst: vi.fn().mockResolvedValue({ id: clientId }) },
        } as never,
        { invite } as never,
        {} as never,
      );
      await expect(
        service.createUser({ organizationId: org } as never, {
          email: 'synthetic@example.test',
          fullName: 'Synthetic',
          roleIds: roles.map((r) => r.id),
          clientId,
          delivery: 'LINK',
        }),
      ).rejects.toThrow('EXPECTED_VALID_INVITATION');
      expect(invite).toHaveBeenCalledOnce();
    },
  );
  it.each([['client'], ['client', 'custom']])(
    'rejects restricted roles without binding before external invitation %j',
    async (...keys) => {
      const invite = vi.fn().mockRejectedValue(new Error('INVITATION_REACHED'));
      const roles = keys.map((key, i) => ({ id: `role-${i}`, key }));
      const prisma = {
        role: { findMany: vi.fn().mockResolvedValue(roles) },
        client: { findFirst: vi.fn() },
      };
      const service = new AdminService(prisma as never, { invite } as never, {} as never);
      await expect(
        service.createUser({ organizationId: org } as never, {
          email: 'synthetic@example.test',
          fullName: 'Synthetic',
          roleIds: roles.map((r) => r.id),
          delivery: 'LINK',
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(invite).not.toHaveBeenCalled();
    },
  );
  it('rejects a foreign or deleted binding before invitation', async () => {
    const invite = vi.fn();
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new AdminService(
      {
        role: { findMany: vi.fn().mockResolvedValue([{ id: 'role', key: 'client' }]) },
        client: { findFirst },
      } as never,
      { invite } as never,
      {} as never,
    );
    await expect(
      service.createUser({ organizationId: org } as never, {
        email: 'synthetic@example.test',
        fullName: 'Synthetic',
        roleIds: ['role'],
        clientId,
        delivery: 'LINK',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: clientId, organizationId: org, deletedAt: null },
    });
    expect(invite).not.toHaveBeenCalled();
  });
});
