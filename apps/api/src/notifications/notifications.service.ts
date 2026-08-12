import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@livio/db';
import type { AuthenticatedActor } from '@livio/shared';
import { PrismaService } from '../prisma/prisma.service';

type FinancialAlertRow = {
  installment_id: string;
  client_id: string;
  client_name: string;
  reference: string;
  due_date: Date;
  balance: Prisma.Decimal;
  alert_kind: 'OVERDUE' | 'DUE_SOON';
};

type AlertMetadata = {
  source: 'FINANCIAL_DUE';
  kind: FinancialAlertRow['alert_kind'];
  installmentId: string;
  clientId: string;
  dueDate: string;
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async reconcileFinancialAlerts(actor: AuthenticatedActor) {
    const clientScope = actor.clientId
      ? Prisma.sql`AND r.client_id = ${actor.clientId}::uuid`
      : Prisma.empty;
    const alerts = await this.prisma.$queryRaw<FinancialAlertRow[]>(Prisma.sql`
      WITH paid AS (
        SELECT pa.installment_id, SUM(pa.amount) AS amount
        FROM payment_allocations pa
        JOIN payments p ON p.id = pa.payment_id AND p.status = 'CONFIRMED'
        WHERE pa.organization_id = ${actor.organizationId}::uuid AND pa.reversed_at IS NULL
        GROUP BY pa.installment_id
      ), adjustments AS (
        SELECT installment_id,
          SUM(CASE WHEN kind IN ('DISCOUNT', 'REVERSAL') THEN -amount ELSE amount END) AS amount
        FROM financial_adjustments
        WHERE organization_id = ${actor.organizationId}::uuid AND approved_at IS NOT NULL
        GROUP BY installment_id
      )
      SELECT i.id AS installment_id, r.client_id, c.display_name AS client_name,
        r.reference, i.due_date,
        (i.amount + COALESCE(a.amount, 0) - COALESCE(p.amount, 0))::numeric(19,4) AS balance,
        CASE WHEN i.due_date < CURRENT_DATE THEN 'OVERDUE' ELSE 'DUE_SOON' END AS alert_kind
      FROM receivable_installments i
      JOIN receivables r ON r.id = i.receivable_id
      JOIN clients c ON c.id = r.client_id
      LEFT JOIN paid p ON p.installment_id = i.id
      LEFT JOIN adjustments a ON a.installment_id = i.id
      WHERE i.organization_id = ${actor.organizationId}::uuid
        AND i.status NOT IN ('PAID', 'CANCELLED', 'RENEGOTIATED')
        AND i.due_date <= CURRENT_DATE + INTERVAL '7 days'
        AND (i.amount + COALESCE(a.amount, 0) - COALESCE(p.amount, 0)) > 0
        ${clientScope}
      ORDER BY i.due_date ASC`);

    const activeIds = new Set(alerts.map((alert) => alert.installment_id));
    const previous = await this.prisma.notification.findMany({
      where: {
        organizationId: actor.organizationId,
        userId: actor.userId,
      },
      select: { id: true, status: true, metadata: true },
    });
    const resolvedIds = previous
      .filter(({ metadata, status }) => {
        const value = metadata as AlertMetadata | null;
        return (
          status !== 'READ' &&
          value?.source === 'FINANCIAL_DUE' &&
          !activeIds.has(value.installmentId)
        );
      })
      .map(({ id }) => id);

    const now = new Date();
    await this.prisma.$transaction([
      ...(resolvedIds.length
        ? [
            this.prisma.notification.updateMany({
              where: { id: { in: resolvedIds }, organizationId: actor.organizationId },
              data: { status: 'READ', readAt: now },
            }),
          ]
        : []),
      ...alerts.map((alert) => {
        const overdue = alert.alert_kind === 'OVERDUE';
        const metadata: AlertMetadata = {
          source: 'FINANCIAL_DUE',
          kind: alert.alert_kind,
          installmentId: alert.installment_id,
          clientId: alert.client_id,
          dueDate: alert.due_date.toISOString().slice(0, 10),
        };
        const data = {
          organizationId: actor.organizationId,
          userId: actor.userId,
          channel: 'IN_APP' as const,
          status: 'SENT' as const,
          title: overdue ? 'Parcela vencida' : 'Parcela próxima do vencimento',
          body: `${alert.client_name} · ${alert.reference} · saldo ${alert.balance.toFixed(2)}`,
          link: `client:${alert.client_id}`,
          metadata: metadata as unknown as Prisma.InputJsonValue,
          sentAt: now,
        };
        return this.prisma.notification.upsert({
          where: { id: this.alertId(actor.userId, alert.installment_id) },
          create: { id: this.alertId(actor.userId, alert.installment_id), ...data },
          update: {
            title: data.title,
            body: data.body,
            link: data.link,
            metadata: data.metadata,
          },
        });
      }),
    ]);

    return {
      active: alerts.length,
      overdue: alerts.filter((item) => item.alert_kind === 'OVERDUE').length,
    };
  }

  async reconcileTaskReminders(actor: AuthenticatedActor) {
    const now = new Date();
    const reminders = await this.prisma.taskReminder.findMany({
      where: {
        organizationId: actor.organizationId,
        status: 'PENDING',
        remindAt: { lte: now },
        task: {
          deletedAt: null,
          ...(actor.clientId ? { clientId: actor.clientId } : {}),
          OR: [{ assigneeId: actor.userId }, { assigneeId: null, createdById: actor.userId }],
        },
      },
      select: {
        id: true,
        remindAt: true,
        task: { select: { id: true, title: true, dueAt: true } },
      },
      orderBy: { remindAt: 'asc' },
      take: 100,
    });
    await this.prisma.$transaction(
      reminders.flatMap((reminder) => [
        this.prisma.notification.upsert({
          where: { id: this.reminderId(actor.userId, reminder.id) },
          create: {
            id: this.reminderId(actor.userId, reminder.id),
            organizationId: actor.organizationId,
            userId: actor.userId,
            channel: 'IN_APP',
            status: 'SENT',
            title: 'Lembrete de tarefa',
            body: reminder.task.title,
            link: `task:${reminder.task.id}`,
            metadata: {
              source: 'TASK_REMINDER',
              taskId: reminder.task.id,
              reminderId: reminder.id,
              dueAt: reminder.task.dueAt?.toISOString() ?? null,
            },
            sentAt: now,
          },
          update: { title: 'Lembrete de tarefa', body: reminder.task.title },
        }),
        this.prisma.taskReminder.updateMany({
          where: { id: reminder.id, organizationId: actor.organizationId, status: 'PENDING' },
          data: { status: 'SENT', sentAt: now },
        }),
      ]),
    );
    return reminders.length;
  }

  async reconcileUserAlerts(actor: AuthenticatedActor) {
    const [financial, taskReminders] = await Promise.all([
      this.reconcileFinancialAlerts(actor),
      this.reconcileTaskReminders(actor),
    ]);
    return { ...financial, taskReminders };
  }

  async reconcileAllFinancialAlerts() {
    const recipients = await this.prisma.organizationMember.findMany({
      where: {
        status: 'ACTIVE',
        user: { status: 'ACTIVE', deletedAt: null },
        organization: { status: 'ACTIVE' },
        roles: {
          some: {
            role: {
              permissions: {
                some: { permission: { resource: 'notifications', action: 'update' } },
              },
            },
          },
        },
      },
      select: {
        id: true,
        profileId: true,
        organizationId: true,
        userId: true,
        clientId: true,
      },
    });
    const results = await Promise.all(
      recipients.map((recipient) =>
        this.reconcileUserAlerts({
          membershipId: recipient.id,
          profileId: recipient.profileId,
          organizationId: recipient.organizationId,
          userId: recipient.userId,
          ...(recipient.clientId ? { clientId: recipient.clientId } : {}),
          permissions: ['notifications:view', 'notifications:update'],
        }),
      ),
    );
    return {
      recipients: recipients.length,
      active: results.reduce((total, result) => total + result.active, 0),
      overdue: results.reduce((total, result) => total + result.overdue, 0),
      taskReminders: results.reduce((total, result) => total + result.taskReminders, 0),
    };
  }

  async list(actor: AuthenticatedActor) {
    const items = await this.prisma.notification.findMany({
      where: { organizationId: actor.organizationId, userId: actor.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { items, unread: items.filter(({ status }) => status !== 'READ').length };
  }

  async markRead(actor: AuthenticatedActor, id: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, organizationId: actor.organizationId, userId: actor.userId },
      data: { status: 'READ', readAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Notificação não encontrada');
    return { id, status: 'READ' as const };
  }

  private alertId(userId: string, installmentId: string) {
    const hex = createHash('sha256')
      .update(`${userId}:${installmentId}:financial-due`)
      .digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }

  private reminderId(userId: string, reminderId: string) {
    const hex = createHash('sha256').update(`${userId}:${reminderId}:task-reminder`).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
}
