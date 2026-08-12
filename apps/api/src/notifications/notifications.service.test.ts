import { Prisma } from '@livio/db';
import type { AuthenticatedActor } from '@livio/shared';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';

const actor: AuthenticatedActor = {
  userId: '11111111-1111-4111-8111-111111111111',
  sessionId: 'session',
  organizationId: '22222222-2222-4222-8222-222222222222',
  permissions: ['notifications:view', 'notifications:update'],
};

const alert = {
  installment_id: '33333333-3333-4333-8333-333333333333',
  client_id: '44444444-4444-4444-8444-444444444444',
  client_name: 'Cliente teste',
  reference: 'HON-001',
  due_date: new Date('2026-08-10T00:00:00.000Z'),
  balance: new Prisma.Decimal('250.00'),
  alert_kind: 'OVERDUE' as const,
};

describe('alertas financeiros', () => {
  it('cria uma notificação determinística para parcela vencida', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([alert]),
      $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
      notification: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert,
      },
    };
    const service = new NotificationsService(prisma as never);

    await expect(service.reconcileFinancialAlerts(actor)).resolves.toEqual({
      active: 1,
      overdue: 1,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'SENT',
          title: 'Parcela vencida',
          link: `client:${alert.client_id}`,
        }),
      }),
    );
  });

  it('preserva como lido um alerta ainda ativo', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([alert]),
      $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
      notification: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'existing-alert',
            status: 'READ',
            metadata: {
              source: 'FINANCIAL_DUE',
              kind: 'OVERDUE',
              installmentId: alert.installment_id,
              clientId: alert.client_id,
              dueDate: '2026-08-10',
            },
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert,
      },
    };
    const service = new NotificationsService(prisma as never);

    await service.reconcileFinancialAlerts(actor);

    const update = upsert.mock.calls[0]?.[0].update as Record<string, unknown>;
    expect(update).not.toHaveProperty('status');
    expect(update).not.toHaveProperty('readAt');
  });

  it('restringe a consulta financeira ao cliente vinculado à sessão', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
      notification: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn(),
      },
    };
    const service = new NotificationsService(prisma as never);
    const clientId = '55555555-5555-4555-8555-555555555555';

    await service.reconcileFinancialAlerts({ ...actor, clientId });

    const query = prisma.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql;
    expect(query.strings.join(' ')).toContain('r.client_id');
    expect(query.values).toContain(clientId);
  });

  it('reconcilia alertas de todos os destinatários ativos', async () => {
    const prisma = {
      organizationMember: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'membership',
            profileId: 'profile',
            organizationId: actor.organizationId,
            userId: actor.userId,
            clientId: null,
          },
        ]),
      },
      $queryRaw: vi.fn().mockResolvedValue([alert]),
      $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
      notification: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue({}),
      },
      taskReminder: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const service = new NotificationsService(prisma as never);

    await expect(service.reconcileAllFinancialAlerts()).resolves.toEqual({
      recipients: 1,
      active: 1,
      overdue: 1,
      taskReminders: 0,
    });
  });

  it('transforma lembrete vencido em notificação interna para o responsável', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      taskReminder: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: '66666666-6666-4666-8666-666666666666',
            remindAt: new Date('2026-08-12T11:00:00.000Z'),
            task: {
              id: '77777777-7777-4777-8777-777777777777',
              title: 'Protocolar manifestação',
              dueAt: new Date('2026-08-13T11:00:00.000Z'),
            },
          },
        ]),
        updateMany,
      },
      notification: { upsert },
      $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = new NotificationsService(prisma as never);

    await expect(service.reconcileTaskReminders(actor)).resolves.toBe(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          title: 'Lembrete de tarefa',
          link: 'task:77777777-7777-4777-8777-777777777777',
        }),
      }),
    );
    expect(updateMany).toHaveBeenCalled();
  });
});
