import { createHash } from 'node:crypto';
import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@livio/db';
import type { AuthenticatedActor } from '@livio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PushNotificationsService } from './push-notifications.service';
import { dueAccessAlertTime } from './access-alert-schedule';

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

const RECONCILIATION_BATCH_SIZE = 8;

function jsonRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function digestId(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function validTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return timeZone;
  } catch {
    return 'America/Sao_Paulo';
  }
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly pushNotifications?: PushNotificationsService,
  ) {}

  async reconcileFinancialAlerts(actor: AuthenticatedActor) {
    if (!actor.permissions.includes('receivables:view')) return { active: 0, overdue: 0 };
    const clientScope = actor.clientId
      ? Prisma.sql`AND r.client_id = ${actor.clientId}::uuid`
      : Prisma.empty;
    const alerts = await this.prisma.$queryRaw<FinancialAlertRow[]>(Prisma.sql`
      WITH target_installments AS MATERIALIZED (
        SELECT i.id, i.amount, i.due_date, r.client_id,
          c.display_name AS client_name, r.reference
        FROM receivable_installments i
        JOIN receivables r ON r.id = i.receivable_id
        JOIN clients c ON c.id = r.client_id
        WHERE i.organization_id = ${actor.organizationId}::uuid
          AND i.status NOT IN ('PAID', 'CANCELLED', 'RENEGOTIATED')
          AND i.due_date <= CURRENT_DATE + INTERVAL '7 days'
          ${clientScope}
      ), paid AS (
        SELECT pa.installment_id, SUM(pa.amount) AS amount
        FROM payment_allocations pa
        JOIN target_installments target ON target.id = pa.installment_id
        JOIN payments p ON p.id = pa.payment_id AND p.status = 'CONFIRMED'
        WHERE pa.organization_id = ${actor.organizationId}::uuid AND pa.reversed_at IS NULL
        GROUP BY pa.installment_id
      ), adjustments AS (
        SELECT adjustment.installment_id,
          SUM(CASE WHEN adjustment.kind IN ('DISCOUNT', 'REVERSAL')
            THEN -adjustment.amount ELSE adjustment.amount END) AS amount
        FROM financial_adjustments adjustment
        JOIN target_installments target ON target.id = adjustment.installment_id
        WHERE adjustment.organization_id = ${actor.organizationId}::uuid
          AND adjustment.approved_at IS NOT NULL
        GROUP BY adjustment.installment_id
      )
      SELECT i.id AS installment_id, i.client_id, i.client_name,
        i.reference, i.due_date,
        (i.amount + COALESCE(a.amount, 0) - COALESCE(p.amount, 0))::numeric(19,4) AS balance,
        CASE WHEN i.due_date < CURRENT_DATE THEN 'OVERDUE' ELSE 'DUE_SOON' END AS alert_kind
      FROM target_installments i
      LEFT JOIN paid p ON p.installment_id = i.id
      LEFT JOIN adjustments a ON a.installment_id = i.id
      WHERE (i.amount + COALESCE(a.amount, 0) - COALESCE(p.amount, 0)) > 0
      ORDER BY i.due_date ASC`);

    const activeIds = new Set(alerts.map((alert) => alert.installment_id));
    const previous = await this.prisma.notification.findMany({
      where: {
        organizationId: actor.organizationId,
        userId: actor.userId,
        metadata: { path: ['source'], equals: 'FINANCIAL_DUE' },
      },
      select: { id: true, status: true, title: true, body: true, link: true, metadata: true },
    });
    const previousById = new Map(previous.map((item) => [item.id, item]));
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
    const changedAlerts: FinancialAlertRow[] = [];
    await this.prisma.$transaction([
      ...(resolvedIds.length
        ? [
            this.prisma.notification.updateMany({
              where: { id: { in: resolvedIds }, organizationId: actor.organizationId },
              data: { status: 'READ', readAt: now },
            }),
          ]
        : []),
      ...alerts.flatMap((alert) => {
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
        const id = this.alertId(actor.userId, alert.installment_id);
        const existing = previousById.get(id);
        const oldMetadata = existing?.metadata as AlertMetadata | null;
        if (
          existing?.title === data.title &&
          existing.body === data.body &&
          existing.link === data.link &&
          oldMetadata?.source === metadata.source &&
          oldMetadata.kind === metadata.kind &&
          oldMetadata.installmentId === metadata.installmentId &&
          oldMetadata.clientId === metadata.clientId &&
          oldMetadata.dueDate === metadata.dueDate
        ) {
          return [];
        }
        changedAlerts.push(alert);
        return [
          this.prisma.notification.upsert({
            where: { id },
            create: { id, ...data },
            update: {
              title: data.title,
              body: data.body,
              link: data.link,
              metadata: data.metadata,
            },
          }),
        ];
      }),
    ]);

    if (changedAlerts.length)
      await this.pushNotifications?.notifyUsers(actor.organizationId, [actor.userId], {
        title:
          changedAlerts.length === 1
            ? 'Novo alerta financeiro'
            : `${changedAlerts.length} novos alertas financeiros`,
        body: 'Entre no Lívio para conferir os vencimentos.',
      });

    return {
      active: alerts.length,
      overdue: alerts.filter((item) => item.alert_kind === 'OVERDUE').length,
    };
  }

  async reconcileTaskReminders(actor: AuthenticatedActor) {
    if (!actor.permissions.includes('tasks:view')) return 0;
    const now = new Date();
    const reminders = await this.prisma.taskReminder.findMany({
      where: {
        organizationId: actor.organizationId,
        status: 'PENDING',
        remindAt: { lte: now },
        task: {
          deletedAt: null,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
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
    if (reminders.length)
      await this.pushNotifications?.notifyUsers(actor.organizationId, [actor.userId], {
        title:
          reminders.length === 1 ? 'Lembrete de tarefa' : `${reminders.length} lembretes de tarefa`,
        body: 'Entre no Lívio para consultar seus lembretes.',
      });
    return reminders.length;
  }

  async reconcileUserAlerts(actor: AuthenticatedActor) {
    const [financial, taskReminders, hearings] = await Promise.all([
      this.reconcileFinancialAlerts(actor),
      this.reconcileTaskReminders(actor),
      this.reconcileHearingReminders(actor),
    ]);
    return { ...financial, taskReminders, hearings: hearings.sent };
  }

  async reconcileAccessDigests() {
    const organizations = await this.prisma.organization.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, settings: true, timezone: true },
    });
    const now = new Date();
    let digests = 0;
    for (const organization of organizations) {
      const settings = jsonRecord(organization.settings);
      const configValue = settings.accessAlerts;
      if (!configValue || typeof configValue !== 'object' || Array.isArray(configValue)) continue;
      const config = configValue as Record<string, Prisma.JsonValue>;
      const after = typeof config.lastDigestAt === 'string' ? new Date(config.lastDigestAt) : now;
      const times = Array.isArray(config.times)
        ? config.times.filter((value): value is string => typeof value === 'string')
        : [];
      if (
        config.enabled !== true ||
        !dueAccessAlertTime(now, after, validTimeZone(organization.timezone), times)
      )
        continue;

      const digest = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${organization.id}::uuid FOR UPDATE`;
        const current = await transaction.organization.findUniqueOrThrow({
          where: { id: organization.id },
          select: { settings: true },
        });
        const currentSettings = jsonRecord(current.settings);
        const currentValue = currentSettings.accessAlerts;
        if (!currentValue || typeof currentValue !== 'object' || Array.isArray(currentValue))
          return { sent: false, userIds: [] as string[], count: 0 };
        const currentConfig = currentValue as Record<string, Prisma.JsonValue>;
        const currentTimes = Array.isArray(currentConfig.times)
          ? currentConfig.times.filter((value): value is string => typeof value === 'string')
          : [];
        const cursorValue = currentConfig.lastDigestAt;
        const parsedCursor = typeof cursorValue === 'string' ? new Date(cursorValue) : now;
        const cursor = Number.isNaN(parsedCursor.getTime()) ? now : parsedCursor;
        const time = dueAccessAlertTime(
          now,
          cursor,
          validTimeZone(organization.timezone),
          currentTimes,
        );
        if (currentConfig.enabled !== true || !time)
          return { sent: false, userIds: [] as string[], count: 0 };
        const eventFilter = {
          organizationId: organization.id,
          type: 'SYSTEM_ACCESS',
          occurredAt: { gt: cursor, lte: now },
        };
        const eventCount = await transaction.activityEvent.count({ where: eventFilter });
        const events = await transaction.activityEvent.findMany({
          where: eventFilter,
          select: { actorUserId: true, occurredAt: true },
          orderBy: { occurredAt: 'asc' },
          take: 20,
        });
        let adminUserIds: string[] = [];
        if (eventCount) {
          const userIds = [
            ...new Set(events.flatMap((event) => (event.actorUserId ? [event.actorUserId] : []))),
          ];
          const users = await transaction.user.findMany({
            where: { id: { in: userIds }, organizationId: organization.id },
            select: { id: true, fullName: true },
          });
          const names = new Map(users.map((user) => [user.id, user.fullName]));
          const admins = await transaction.organizationMember.findMany({
            where: {
              organizationId: organization.id,
              status: 'ACTIVE',
              user: { status: 'ACTIVE', deletedAt: null },
              roles: { some: { role: { key: 'administrator' } } },
            },
            select: { userId: true },
          });
          if (!admins.length) return { sent: false, userIds: [] as string[], count: 0 };
          adminUserIds = admins.map(({ userId }) => userId);
          const lines = events.map((event) => {
            const label = event.actorUserId
              ? (names.get(event.actorUserId) ?? 'Usuário')
              : 'Usuário';
            const occurredAt = new Intl.DateTimeFormat('pt-BR', {
              timeZone: validTimeZone(organization.timezone),
              hour: '2-digit',
              minute: '2-digit',
              day: '2-digit',
              month: '2-digit',
            }).format(event.occurredAt);
            return `${label} · ${occurredAt}`;
          });
          if (eventCount > events.length)
            lines.push(`mais ${eventCount - events.length} acesso(s)`);
          const metadata = {
            source: 'SYSTEM_ACCESS_DIGEST',
            scheduledTime: time,
            count: eventCount,
          } as Prisma.InputJsonValue;
          for (const admin of admins) {
            await transaction.notification.upsert({
              where: {
                id: digestId(`${organization.id}:${admin.userId}:${time}:${cursor.toISOString()}`),
              },
              create: {
                id: digestId(`${organization.id}:${admin.userId}:${time}:${cursor.toISOString()}`),
                organizationId: organization.id,
                userId: admin.userId,
                channel: 'IN_APP',
                status: 'SENT',
                title: `${eventCount} acesso(s) ao sistema`,
                body: lines.join(' · '),
                link: 'admin:access-alerts',
                metadata,
                sentAt: now,
              },
              update: {
                title: `${eventCount} acesso(s) ao sistema`,
                body: lines.join(' · '),
              },
            });
          }
        }
        await transaction.organization.update({
          where: { id: organization.id },
          data: {
            settings: {
              ...currentSettings,
              accessAlerts: { ...currentConfig, lastDigestAt: now.toISOString() },
            } as Prisma.InputJsonValue,
          },
        });
        return {
          sent: eventCount > 0 && adminUserIds.length > 0,
          userIds: adminUserIds,
          count: eventCount,
        };
      });
      if (digest.sent) {
        digests += 1;
        await this.pushNotifications?.notifyUsers(organization.id, digest.userIds, {
          title: `${digest.count} acesso(s) ao sistema`,
          body: 'O resumo de acessos está disponível no Lívio.',
        });
      }
    }
    return { digests };
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
        roles: {
          select: {
            role: {
              select: {
                permissions: {
                  where: {
                    permission: { resource: { in: ['receivables', 'tasks'] }, action: 'view' },
                  },
                  select: { permission: { select: { resource: true } } },
                },
              },
            },
          },
        },
      },
    });
    const results: Array<{ active: number; overdue: number; taskReminders: number }> = [];
    for (let start = 0; start < recipients.length; start += RECONCILIATION_BATCH_SIZE) {
      const batch = recipients.slice(start, start + RECONCILIATION_BATCH_SIZE);
      results.push(
        ...(await Promise.all(
          batch.map((recipient) =>
            this.reconcileUserAlerts({
              membershipId: recipient.id,
              profileId: recipient.profileId,
              organizationId: recipient.organizationId,
              userId: recipient.userId,
              ...(recipient.clientId ? { clientId: recipient.clientId } : {}),
              permissions: [
                'notifications:view',
                'notifications:update',
                ...recipient.roles.flatMap(({ role }) =>
                  role.permissions.map(
                    ({ permission }) =>
                      `${permission.resource}:view` as 'receivables:view' | 'tasks:view',
                  ),
                ),
              ],
            }),
          ),
        )),
      );
    }
    return {
      recipients: recipients.length,
      active: results.reduce((total, result) => total + result.active, 0),
      overdue: results.reduce((total, result) => total + result.overdue, 0),
      taskReminders: results.reduce((total, result) => total + result.taskReminders, 0),
    };
  }

  async dispatchScheduledAlerts() {
    const [hearings, access, members] = await Promise.all([
      this.reconcileHearingReminders(),
      this.reconcileAccessDigests(),
      this.prisma.organizationMember.findMany({
        where: {
          status: 'ACTIVE',
          organization: { status: 'ACTIVE' },
          user: { status: 'ACTIVE', deletedAt: null },
          AND: ['tasks', 'notifications'].map((resource) => ({
            roles: {
              some: {
                role: {
                  permissions: {
                    some: {
                      permission: { resource, action: resource === 'tasks' ? 'view' : 'update' },
                    },
                  },
                },
              },
            },
          })),
        },
        select: { organizationId: true, userId: true, clientId: true },
      }),
    ]);
    let tasks = 0;
    for (let start = 0; start < members.length; start += RECONCILIATION_BATCH_SIZE) {
      const counts = await Promise.all(
        members.slice(start, start + RECONCILIATION_BATCH_SIZE).map((member) =>
          this.reconcileTaskReminders({
            organizationId: member.organizationId,
            userId: member.userId,
            ...(member.clientId ? { clientId: member.clientId } : {}),
            permissions: ['tasks:view', 'notifications:update'],
          }),
        ),
      );
      tasks += counts.reduce((sum, count) => sum + count, 0);
    }
    return { hearings, access, tasks };
  }

  async reconcileHearingReminders(actor?: AuthenticatedActor) {
    const now = new Date();
    const due = await this.prisma.notification.findMany({
      where: {
        channel: 'IN_APP',
        status: 'PENDING',
        scheduledAt: { lte: now },
        metadata: { path: ['source'], equals: 'HEARING_REMINDER' },
        ...(actor ? { organizationId: actor.organizationId, userId: actor.userId } : {}),
        organization: { status: 'ACTIVE' },
      },
      select: { id: true, organizationId: true, userId: true },
      orderBy: { scheduledAt: 'asc' },
      take: 500,
    });
    const claimed: typeof due = [];
    for (const reminder of due) {
      const result = await this.prisma.notification.updateMany({
        where: {
          id: reminder.id,
          organizationId: reminder.organizationId,
          userId: reminder.userId,
          status: 'PENDING',
          scheduledAt: { lte: now },
        },
        data: { status: 'SENT', sentAt: now },
      });
      if (result.count) claimed.push(reminder);
    }

    const recipients = new Map<string, { organizationId: string; userId: string }>();
    for (const reminder of claimed) {
      const key = `${reminder.organizationId}:${reminder.userId}`;
      recipients.set(key, {
        organizationId: reminder.organizationId,
        userId: reminder.userId,
      });
    }
    await Promise.all(
      [...recipients.values()].map(({ organizationId, userId }) =>
        this.pushNotifications?.notifyUsers(organizationId, [userId], {
          title: 'Lembrete de audiência',
          body: 'Uma audiência se aproxima. Entre no Lívio para conferir o horário.',
        }),
      ),
    );
    return { sent: claimed.length, recipients: recipients.size };
  }

  async list(actor: AuthenticatedActor) {
    const items = await this.prisma.notification.findMany({
      where: {
        organizationId: actor.organizationId,
        userId: actor.userId,
        status: { in: ['SENT', 'READ'] },
      },
      orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    return { items, unread: items.filter(({ status }) => status !== 'READ').length };
  }

  async markRead(actor: AuthenticatedActor, id: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        id,
        organizationId: actor.organizationId,
        userId: actor.userId,
        status: { in: ['SENT', 'READ'] },
      },
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
