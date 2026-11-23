import type { AuthenticatedActor } from '@livio/shared';
import { describe, expect, it, vi } from 'vitest';
import { WorkService } from './work.service';
import { calendarEventSchema, updateCalendarEventSchema } from './work.schemas';

const actor: AuthenticatedActor = {
  userId: 'user-a',
  sessionId: 'session-a',
  organizationId: 'org-a',
  permissions: ['calendar:update'],
};

describe('Task responsible directory', () => {
  it('returns only active, undeleted staff of the authenticated organization without sensitive fields', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new WorkService({ user: { findMany } } as never, {} as never);
    await service.listTaskResponsibles(actor);
    expect(findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a', status: 'ACTIVE', clientId: null, deletedAt: null },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
  });

  it('denies portal identities even when granted a task permission', () => {
    const findMany = vi.fn();
    const service = new WorkService({ user: { findMany } } as never, {} as never);
    expect(() => service.listTaskResponsibles({ ...actor, clientId: 'client-a' })).toThrow();
    expect(findMany).not.toHaveBeenCalled();
  });
});

function fixture() {
  const event = {
    id: 'event-a',
    organizationId: actor.organizationId,
    createdById: actor.userId,
    clientId: null,
    title: 'Audiência de custódia',
    type: 'HEARING',
    status: 'SCHEDULED',
    startsAt: new Date('2030-05-21T13:00:00.000Z'),
    endsAt: new Date('2030-05-21T14:00:00.000Z'),
    reminderMinutes: [60, 45, 10],
  };
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: event.id }]),
    calendarEvent: {
      findFirst: vi.fn().mockImplementation(async () => ({ ...event })),
      create: vi.fn().mockResolvedValue(event),
      update: vi.fn().mockImplementation(async ({ data }) => Object.assign(event, data)),
    },
    notification: {
      deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(transaction)),
  };
  const service = new WorkService(prisma as never, { record: vi.fn() } as never);
  return { event, transaction, service };
}

describe('WorkService alertas de audiência', () => {
  it('agenda os três avisos padrão na criação direta', async () => {
    const { event, transaction, service } = fixture();
    await service.createEvent(actor, {
      title: event.title,
      type: 'HEARING',
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: 'America/Sao_Paulo',
      allDay: false,
      attendees: [],
    });
    expect(
      transaction.notification.create.mock.calls.map(
        ([input]) => input.data.metadata.minutesBefore,
      ),
    ).toEqual([60, 30, 10]);
    expect(transaction.calendarEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reminderMinutes: [60, 30, 10] }) }),
    );
  });

  it('reagenda todos os intervalos personalizados, inclusive depois de avisos já enviados', async () => {
    const { event, transaction, service } = fixture();
    const startsAt = new Date('2030-05-22T13:00:00.000Z');
    await service.updateEvent(actor, event.id, {
      startsAt,
      endsAt: new Date('2030-05-22T14:00:00.000Z'),
    });
    expect(transaction.notification.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING', organizationId: actor.organizationId }),
      }),
    );
    expect(
      transaction.notification.create.mock.calls.map(([input]) => input.data.scheduledAt),
    ).toEqual([60, 45, 10].map((minutes) => new Date(startsAt.getTime() - minutes * 60_000)));
  });

  it('cancela somente avisos pendentes e conserva preferências ao reativar', async () => {
    const { event, transaction, service } = fixture();
    await service.updateEvent(actor, event.id, { status: 'CANCELLED' });
    expect(transaction.notification.deleteMany).toHaveBeenCalledTimes(1);
    expect(transaction.notification.create).not.toHaveBeenCalled();
    expect(event.reminderMinutes).toEqual([60, 45, 10]);
    await service.updateEvent(actor, event.id, { status: 'SCHEDULED' });
    expect(transaction.notification.create).toHaveBeenCalledTimes(3);
  });

  it('permite editar intervalos e desativar todos os alertas', async () => {
    const { event, transaction, service } = fixture();
    await service.updateEvent(actor, event.id, { reminderMinutes: [120] });
    expect(transaction.notification.create).toHaveBeenCalledTimes(1);
    transaction.notification.create.mockClear();
    await service.updateEvent(actor, event.id, { reminderMinutes: [] });
    expect(transaction.notification.create).not.toHaveBeenCalled();
    expect(event.reminderMinutes).toEqual([]);
  });

  it('valida o intervalo completo mesmo quando a atualização envia só o início', async () => {
    const { event, transaction, service } = fixture();
    await expect(
      service.updateEvent(actor, event.id, { startsAt: new Date('2030-05-22T13:00:00.000Z') }),
    ).rejects.toThrow('O fim deve ser posterior');
    expect(transaction.calendarEvent.update).not.toHaveBeenCalled();
    expect(transaction.notification.deleteMany).not.toHaveBeenCalled();
  });

  it('nega atualização de evento de outra organização', async () => {
    const { event, transaction, service } = fixture();
    transaction.calendarEvent.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.updateEvent(actor, event.id, { status: 'CANCELLED' })).rejects.toThrow(
      'Evento não encontrado',
    );
    expect(transaction.calendarEvent.update).not.toHaveBeenCalled();
  });

  it('valida fusos e intervalos também na edição', () => {
    expect(updateCalendarEventSchema.safeParse({ reminderMinutes: [30, 30] }).success).toBe(false);
    expect(updateCalendarEventSchema.safeParse({ reminderMinutes: [] }).success).toBe(true);
    expect(
      calendarEventSchema.safeParse({
        title: 'Audiência',
        type: 'HEARING',
        startsAt: '2030-01-01T12:00:00Z',
        endsAt: '2030-01-01T13:00:00Z',
        timezone: 'Invalid/Zone',
      }).success,
    ).toBe(false);
  });
});
