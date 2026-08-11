import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@livio/db';
import type { AuthenticatedActor } from '@livio/shared';
import { AuditService } from '../common/audit.service';
import { pageResult, pageWindow, type PaginationInput } from '../common/schemas';
import { normalizeAndValidateTaxId } from '../common/tax-id';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateClientInput,
  CreateContactInput,
  UpdateClientInput,
  UpdateContactInput,
} from './client.schemas';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedActor, input: PaginationInput) {
    const search = input.search?.trim();
    const digits = search?.replace(/\D/g, '');
    const where = {
      organizationId: actor.organizationId,
      deletedAt: null,
      ...(actor.clientId ? { id: actor.clientId } : {}),
      ...(search
        ? {
            OR: [
              { displayName: { contains: search, mode: 'insensitive' as const } },
              { legalName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search } },
              ...(digits ? [{ taxIdNormalized: { contains: digits } }] : []),
              {
                contacts: {
                  some: {
                    OR: [
                      { name: { contains: search, mode: 'insensitive' as const } },
                      { email: { contains: search, mode: 'insensitive' as const } },
                      { phone: { contains: search } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        ...pageWindow(input),
        orderBy: { displayName: 'asc' },
        include: { contacts: true },
      }),
      this.prisma.client.count({ where }),
    ]);
    return pageResult(items, total, input);
  }

  async get(actor: AuthenticatedActor, id: string) {
    const client = await this.prisma.client.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(actor.clientId ? { id: actor.clientId } : {}),
      },
      include: { contacts: true },
    });
    if (!client) throw new NotFoundException('Cliente não encontrado');
    return client;
  }

  async overview(actor: AuthenticatedActor, id: string) {
    const client = await this.get(actor, id);
    const scope = { organizationId: actor.organizationId, clientId: id };
    const [
      matters,
      contracts,
      receivables,
      payments,
      documents,
      tasks,
      events,
      notes,
      messages,
      timeline,
    ] = await this.prisma.$transaction([
      this.prisma.matter.findMany({
        where: { ...scope, deletedAt: null },
        select: {
          id: true,
          reference: true,
          title: true,
          status: true,
          priority: true,
          updatedAt: true,
          currentStage: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      this.prisma.contract.findMany({
        where: scope,
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          fixedAmount: true,
          currency: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.receivable.findMany({
        where: scope,
        select: {
          id: true,
          reference: true,
          status: true,
          originalAmount: true,
          currency: true,
          dueDate: true,
          installments: {
            select: {
              id: true,
              sequence: true,
              status: true,
              amount: true,
              dueDate: true,
              allocations: {
                where: { reversedAt: null, payment: { status: 'CONFIRMED' } },
                select: { amount: true },
              },
              adjustments: {
                where: { approvedAt: { not: null } },
                select: { kind: true, amount: true },
              },
            },
          },
        },
        orderBy: { dueDate: 'asc' },
        take: 50,
      }),
      this.prisma.payment.findMany({
        where: scope,
        select: {
          id: true,
          reference: true,
          amount: true,
          currency: true,
          status: true,
          paidAt: true,
          method: true,
          documents: { select: { id: true, title: true } },
        },
        orderBy: { paidAt: 'desc' },
        take: 20,
      }),
      this.prisma.document.findMany({
        where: { ...scope, deletedAt: null },
        select: { id: true, title: true, category: true, visibility: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      this.prisma.task.findMany({
        where: { ...scope, deletedAt: null },
        select: { id: true, title: true, status: true, priority: true, dueAt: true },
        orderBy: { dueAt: 'asc' },
        take: 20,
      }),
      this.prisma.calendarEvent.findMany({
        where: { ...scope, startsAt: { gte: new Date() } },
        select: { id: true, title: true, type: true, startsAt: true, endsAt: true, timezone: true },
        orderBy: { startsAt: 'asc' },
        take: 20,
      }),
      this.prisma.internalNote.findMany({
        where: { ...scope, deletedAt: null },
        select: { id: true, body: true, createdAt: true, createdById: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.clientMessage.findMany({
        where: { ...scope, deletedAt: null },
        select: { id: true, body: true, publishedAt: true, createdById: true },
        orderBy: { publishedAt: 'desc' },
        take: 20,
      }),
      this.prisma.activityEvent.findMany({
        where: { organizationId: actor.organizationId, subjectType: 'client', subjectId: id },
        select: {
          id: true,
          type: true,
          summary: true,
          metadata: true,
          occurredAt: true,
          actorUserId: true,
        },
        orderBy: { occurredAt: 'desc' },
        take: 50,
      }),
    ]);
    return {
      client,
      contacts: client.contacts,
      matters,
      contracts,
      financial: { receivables, payments },
      documents,
      tasks,
      upcomingEvents: events,
      internalNotes: notes,
      clientMessages: messages,
      timeline,
    };
  }

  async create(actor: AuthenticatedActor, input: CreateClientInput) {
    let taxIdNormalized: string | undefined;
    try {
      taxIdNormalized = normalizeAndValidateTaxId(input.taxId);
    } catch {
      throw new BadRequestException('CPF/CNPJ inválido');
    }
    return this.prisma.$transaction(async (transaction) => {
      const client = await transaction.client.create({
        data: {
          organizationId: actor.organizationId,
          type: input.type,
          displayName: input.displayName,
          ...(input.legalName ? { legalName: input.legalName } : {}),
          ...(taxIdNormalized ? { taxIdNormalized } : {}),
          ...(input.email ? { email: input.email.toLowerCase() } : {}),
          ...(input.phone ? { phone: input.phone } : {}),
          ...(input.source ? { source: input.source } : {}),
          ...(input.address ? { address: input.address as Prisma.InputJsonValue } : {}),
          ...(input.customFields
            ? { customFields: input.customFields as Prisma.InputJsonValue }
            : {}),
        },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CREATE',
        resource: 'client',
        resourceId: client.id,
        after: client,
      });
      return client;
    });
  }

  async update(actor: AuthenticatedActor, id: string, input: UpdateClientInput) {
    const before = await this.get(actor, id);
    const { taxId, address, customFields, ...changes } = input;
    let taxIdNormalized: string | undefined;
    try {
      taxIdNormalized = taxId === undefined ? undefined : normalizeAndValidateTaxId(taxId);
    } catch {
      throw new BadRequestException('CPF/CNPJ inválido');
    }
    return this.prisma.$transaction(async (transaction) => {
      const client = await transaction.client.update({
        where: { id },
        data: {
          ...changes,
          ...(address !== undefined ? { address: address as Prisma.InputJsonValue } : {}),
          ...(customFields !== undefined
            ? { customFields: customFields as Prisma.InputJsonValue }
            : {}),
          ...(input.email ? { email: input.email.toLowerCase() } : {}),
          ...(taxId !== undefined ? { taxIdNormalized: taxIdNormalized ?? null } : {}),
        },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'UPDATE',
        resource: 'client',
        resourceId: id,
        before,
        after: client,
      });
      return client;
    });
  }

  async archive(actor: AuthenticatedActor, id: string): Promise<void> {
    const before = await this.get(actor, id);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.client.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'DELETE',
        resource: 'client',
        resourceId: id,
        before,
      });
    });
  }

  async addContact(actor: AuthenticatedActor, clientId: string, input: CreateContactInput) {
    await this.get(actor, clientId);
    return this.prisma.$transaction(async (transaction) => {
      if (input.isPrimary)
        await transaction.clientContact.updateMany({
          where: { organizationId: actor.organizationId, clientId },
          data: { isPrimary: false },
        });
      const contact = await transaction.clientContact.create({
        data: { organizationId: actor.organizationId, clientId, ...input },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CREATE',
        resource: 'client_contact',
        resourceId: contact.id,
        after: contact,
      });
      return contact;
    });
  }

  async updateContact(
    actor: AuthenticatedActor,
    clientId: string,
    contactId: string,
    input: UpdateContactInput,
  ) {
    await this.get(actor, clientId);
    const before = await this.prisma.clientContact.findFirst({
      where: { id: contactId, clientId, organizationId: actor.organizationId },
    });
    if (!before) throw new NotFoundException('Contato não encontrado');
    return this.prisma.$transaction(async (transaction) => {
      if (input.isPrimary)
        await transaction.clientContact.updateMany({
          where: { organizationId: actor.organizationId, clientId },
          data: { isPrimary: false },
        });
      const contact = await transaction.clientContact.update({
        where: { id: contactId },
        data: input,
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'UPDATE',
        resource: 'client_contact',
        resourceId: contactId,
        before,
        after: contact,
      });
      return contact;
    });
  }
}
