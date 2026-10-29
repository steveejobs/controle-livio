import { randomUUID } from 'node:crypto';
import { Prisma } from '@livio/db';

export const DEFAULT_HEARING_REMINDERS = [60, 30, 10] as const;

export async function scheduleHearingReminders(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    userId: string;
    eventId: string;
    eventTitle: string;
    startsAt: Date;
    reminderMinutes?: readonly number[];
    clientId?: string;
    contractId?: string;
  },
) {
  const now = new Date();
  const reminderMinutes = [...new Set(input.reminderMinutes ?? DEFAULT_HEARING_REMINDERS)].sort(
    (left, right) => right - left,
  );
  for (const minutesBefore of reminderMinutes) {
    if (!Number.isInteger(minutesBefore) || minutesBefore < 1 || minutesBefore > 10_080) continue;
    const scheduledAt = new Date(input.startsAt.getTime() - minutesBefore * 60_000);
    if (scheduledAt <= now) continue;
    await transaction.notification.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        userId: input.userId,
        channel: 'IN_APP',
        status: 'PENDING',
        title: `Audiência em ${minutesBefore} min`,
        body: input.eventTitle,
        link: `calendar:event:${input.eventId}`,
        metadata: {
          source: 'HEARING_REMINDER',
          eventId: input.eventId,
          ...(input.contractId ? { contractId: input.contractId } : {}),
          ...(input.clientId ? { clientId: input.clientId } : {}),
          minutesBefore,
          startsAt: input.startsAt.toISOString(),
        } as Prisma.InputJsonValue,
        scheduledAt,
      },
    });
  }
}
