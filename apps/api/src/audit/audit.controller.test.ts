import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedActor } from '@livio/shared';
import { describe, expect, it, vi } from 'vitest';
import { AuditController } from './audit.controller';

const administrator: AuthenticatedActor = {
  userId: 'user-a',
  sessionId: 'session-a',
  organizationId: 'org-a',
  permissions: ['audit:view', 'clients:view'],
  isAdministrator: true,
};

describe('atividades administrativas', () => {
  it('registra a navegação por área somente quando o usuário pode acessá-la', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const controller = new AuditController({ activityEvent: { create } } as never);

    await expect(
      controller.recordModuleView(administrator, { module: 'clients' }),
    ).resolves.toEqual({ recorded: true });
    expect(create.mock.calls[0]![0].data).toMatchObject({
      organizationId: 'org-a',
      actorUserId: 'user-a',
      type: 'MODULE_VIEW',
      summary: 'Abriu Clientes',
      metadata: { module: 'clients' },
    });
    await expect(
      controller.recordModuleView(
        { ...administrator, permissions: ['audit:view'] },
        { module: 'clients' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('registra a ficha de cliente consultada sem ultrapassar a organização do usuário', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const findFirst = vi.fn().mockResolvedValue({ id: 'client-a', displayName: 'Cliente QA' });
    const controller = new AuditController({
      activityEvent: { create },
      client: { findFirst },
    } as never);

    await expect(
      controller.recordClientView(administrator, { clientId: 'client-a' }),
    ).resolves.toEqual({ recorded: true });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'client-a', organizationId: 'org-a', deletedAt: null },
      select: { id: true, displayName: true },
    });
    expect(create.mock.calls[0]![0].data).toMatchObject({
      type: 'CLIENT_VIEW',
      subjectType: 'client',
      subjectId: 'client-a',
      summary: 'Abriu a ficha de cliente: Cliente QA',
    });
  });

  it('apresenta mudanças e navegação com o nome de quem agiu, sem expor valores pessoais', async () => {
    const auditRecord = {
      id: 'audit-a',
      actorUserId: 'user-a',
      action: 'UPDATE',
      resource: 'client',
      resourceId: 'client-a',
      before: { displayName: 'Cliente antes', taxIdNormalized: '52998224725' },
      after: { displayName: 'Cliente depois', taxIdNormalized: '98765432100' },
      createdAt: new Date('2026-10-21T15:00:00.000Z'),
    };
    const activityRecord = {
      id: 'activity-a',
      actorUserId: 'user-a',
      type: 'MODULE_VIEW',
      subjectType: 'user',
      subjectId: 'user-a',
      summary: 'Abriu Clientes',
      metadata: { module: 'clients' },
      occurredAt: new Date('2026-10-21T14:00:00.000Z'),
    };
    const prisma = {
      user: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'user-a', fullName: 'Ana QA', email: 'ana@example.test' }]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([auditRecord]),
        count: vi.fn().mockResolvedValue(1),
      },
      activityEvent: {
        findMany: vi.fn().mockResolvedValue([activityRecord]),
        count: vi.fn().mockResolvedValue(1),
      },
    };
    const controller = new AuditController(prisma as never);

    const result = await controller.list(administrator, {
      page: 1,
      pageSize: 25,
      category: 'all',
      search: undefined,
      actorUserId: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    });

    expect(result.total).toBe(2);
    expect(result.items[0]).toMatchObject({
      kind: 'CHANGE',
      action: 'UPDATE',
      actorName: 'Ana QA',
      targetLabel: 'Cliente depois',
      changedFields: ['Nome', 'CPF/CNPJ'],
    });
    expect(JSON.stringify(result.items)).not.toContain('52998224725');
    expect(result.items[1]).toMatchObject({ kind: 'NAVIGATION', summary: 'Abriu Clientes' });
  });
});
