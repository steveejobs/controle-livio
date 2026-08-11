import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedActor } from '@livio/shared';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CalendarEventInput,
  ClientMessageInput,
  CreateTaskInput,
  InternalNoteInput,
  TaskCommentInput,
  TaskReminderInput,
  UpdateCalendarEventInput,
  UpdateTaskInput,
} from './work.schemas';

@Injectable()
export class WorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createInternalNote(actor: AuthenticatedActor, input: InternalNoteInput) {
    await this.assertLinks(actor.organizationId, input.clientId, input.matterId);
    return this.prisma.$transaction(async (transaction) => {
      const note = await transaction.internalNote.create({
        data: {
          organizationId: actor.organizationId,
          body: input.body,
          confidential: true,
          createdById: actor.userId,
          ...(input.clientId ? { clientId: input.clientId } : {}),
          ...(input.matterId ? { matterId: input.matterId } : {}),
        },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CREATE',
        resource: 'internal_note',
        resourceId: note.id,
        metadata: { clientId: input.clientId, matterId: input.matterId },
      });
      return note;
    });
  }

  listInternalNotes(actor: AuthenticatedActor, clientId?: string, matterId?: string) {
    return this.prisma.internalNote.findMany({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(clientId ? { clientId } : {}),
        ...(matterId ? { matterId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createClientMessage(actor: AuthenticatedActor, input: ClientMessageInput) {
    if (actor.clientId && actor.clientId !== input.clientId)
      throw new ForbiddenException('Cliente fora do escopo da sessão');
    await this.assertLinks(actor.organizationId, input.clientId, input.matterId);
    return this.prisma.$transaction(async (transaction) => {
      const message = await transaction.clientMessage.create({
        data: {
          organizationId: actor.organizationId,
          clientId: input.clientId,
          body: input.body,
          createdById: actor.userId,
          ...(input.matterId ? { matterId: input.matterId } : {}),
        },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CREATE',
        resource: 'client_message',
        resourceId: message.id,
        metadata: { clientId: input.clientId, matterId: input.matterId },
      });
      return message;
    });
  }

  listClientMessages(actor: AuthenticatedActor, clientId?: string, matterId?: string) {
    return this.prisma.clientMessage.findMany({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(actor.clientId ? { clientId: actor.clientId } : clientId ? { clientId } : {}),
        ...(matterId ? { matterId } : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take: 100,
    });
  }

  async createTask(actor: AuthenticatedActor, input: CreateTaskInput) {
    await this.assertLinks(actor.organizationId, input.clientId, input.matterId, input.assigneeId);
    return this.prisma.$transaction(async (transaction) => {
      const task = await transaction.task.create({
        data: {
          organizationId: actor.organizationId,
          title: input.title,
          status: input.status,
          priority: input.priority,
          createdById: actor.userId,
          ...(input.description ? { description: input.description } : {}),
          ...(input.clientId ? { clientId: input.clientId } : {}),
          ...(input.matterId ? { matterId: input.matterId } : {}),
          ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
          ...(input.dueAt ? { dueAt: input.dueAt } : {}),
          ...(input.status === 'COMPLETED' ? { completedAt: new Date() } : {}),
        },
      });
      await transaction.taskHistory.create({
        data: {
          organizationId: actor.organizationId,
          taskId: task.id,
          actorUserId: actor.userId,
          action: 'CREATE',
          after: task,
        },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CREATE',
        resource: 'task',
        resourceId: task.id,
        after: task,
      });
      return task;
    });
  }

  listTasks(actor: AuthenticatedActor) {
    return this.prisma.task.findMany({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(actor.clientId ? { clientId: actor.clientId } : {}),
      },
      include: { reminders: { where: { status: 'PENDING' } } },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
      take: 250,
    });
  }

  async updateTask(actor: AuthenticatedActor, id: string, input: UpdateTaskInput) {
    const before = await this.prisma.task.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Tarefa não encontrada');
    await this.assertLinks(actor.organizationId, input.clientId, input.matterId, input.assigneeId);
    return this.prisma.$transaction(async (transaction) => {
      const task = await transaction.task.update({
        where: { id },
        data: {
          ...input,
          ...(input.status === 'COMPLETED' && before.status !== 'COMPLETED'
            ? { completedAt: new Date() }
            : input.status && input.status !== 'COMPLETED'
              ? { completedAt: null }
              : {}),
        },
      });
      await transaction.taskHistory.create({
        data: {
          organizationId: actor.organizationId,
          taskId: id,
          actorUserId: actor.userId,
          action: 'UPDATE',
          before,
          after: task,
        },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'UPDATE',
        resource: 'task',
        resourceId: id,
        before,
        after: task,
      });
      return task;
    });
  }

  async addTaskComment(actor: AuthenticatedActor, taskId: string, input: TaskCommentInput) {
    await this.assertTask(actor.organizationId, taskId);
    return this.prisma.$transaction(async (transaction) => {
      const comment = await transaction.taskComment.create({
        data: {
          organizationId: actor.organizationId,
          taskId,
          body: input.body,
          createdById: actor.userId,
        },
      });
      await transaction.taskHistory.create({
        data: {
          organizationId: actor.organizationId,
          taskId,
          actorUserId: actor.userId,
          action: 'COMMENT',
          after: { commentId: comment.id },
        },
      });
      return comment;
    });
  }

  async addTaskReminder(actor: AuthenticatedActor, taskId: string, input: TaskReminderInput) {
    await this.assertTask(actor.organizationId, taskId);
    return this.prisma.taskReminder.create({
      data: { organizationId: actor.organizationId, taskId, remindAt: input.remindAt },
    });
  }

  async createEvent(actor: AuthenticatedActor, input: CalendarEventInput) {
    await this.assertLinks(actor.organizationId, input.clientId, input.matterId);
    return this.prisma.$transaction(async (transaction) => {
      const event = await transaction.calendarEvent.create({
        data: {
          organizationId: actor.organizationId,
          title: input.title,
          type: input.type,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          timezone: input.timezone,
          allDay: input.allDay,
          attendees: input.attendees,
          createdById: actor.userId,
          ...(input.description ? { description: input.description } : {}),
          ...(input.location ? { location: input.location } : {}),
          ...(input.clientId ? { clientId: input.clientId } : {}),
          ...(input.matterId ? { matterId: input.matterId } : {}),
          ...(input.recurrenceRule ? { recurrenceRule: input.recurrenceRule } : {}),
        },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CREATE',
        resource: 'calendar_event',
        resourceId: event.id,
        after: event,
      });
      return event;
    });
  }

  listEvents(actor: AuthenticatedActor) {
    return this.prisma.calendarEvent.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(actor.clientId ? { clientId: actor.clientId } : {}),
      },
      orderBy: { startsAt: 'asc' },
      take: 500,
    });
  }

  async updateEvent(actor: AuthenticatedActor, id: string, input: UpdateCalendarEventInput) {
    const before = await this.prisma.calendarEvent.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!before) throw new NotFoundException('Evento não encontrado');
    await this.assertLinks(actor.organizationId, input.clientId, input.matterId);
    return this.prisma.$transaction(async (transaction) => {
      const event = await transaction.calendarEvent.update({ where: { id }, data: input });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'UPDATE',
        resource: 'calendar_event',
        resourceId: id,
        before,
        after: event,
      });
      return event;
    });
  }

  private async assertTask(organizationId: string, taskId: string): Promise<void> {
    if (
      !(await this.prisma.task.findFirst({
        where: { id: taskId, organizationId, deletedAt: null },
      }))
    )
      throw new NotFoundException('Tarefa não encontrada');
  }

  private async assertLinks(
    organizationId: string,
    clientId?: string,
    matterId?: string,
    userId?: string,
  ): Promise<void> {
    const [clientCount, matter, userCount] = await Promise.all([
      clientId
        ? this.prisma.client.count({ where: { id: clientId, organizationId, deletedAt: null } })
        : 1,
      matterId
        ? this.prisma.matter.findFirst({
            where: { id: matterId, organizationId, deletedAt: null },
            select: { clientId: true },
          })
        : { clientId: clientId ?? null },
      userId
        ? this.prisma.user.count({
            where: { id: userId, organizationId, status: 'ACTIVE', deletedAt: null },
          })
        : 1,
    ]);
    if (clientCount !== 1 || !matter || userCount !== 1)
      throw new NotFoundException('Vínculo não encontrado');
    if (clientId && matterId && matter.clientId !== clientId)
      throw new NotFoundException('Processo não pertence ao cliente');
  }
}
