import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@livio/db';
import { calculateOutstandingByCurrency, type AuthenticatedActor } from '@livio/shared';
import { AuditService } from '../common/audit.service';
import { pageResult, pageWindow, type PaginationInput } from '../common/schemas';
import { normalizeAndValidateTaxId } from '../common/tax-id';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../documents/storage.service';
import type {
  CreateClientInput,
  CreateContactInput,
  UpdateClientInput,
  UpdateContactInput,
} from './client.schemas';

type OverviewReceivable = {
  id: string;
  reference: string;
  description: string;
  status: string;
  contractId: string | null;
  originalAmount: Prisma.Decimal;
  currency: string;
  dueDate: Date;
  installments: Array<{
    id: string;
    sequence: number;
    status: string;
    amount: Prisma.Decimal;
    dueDate: Date;
    allocations: Array<{ amount: Prisma.Decimal }>;
    adjustments: Array<{ amount: Prisma.Decimal; kind: string }>;
  }>;
};

@Injectable()
export class ClientsService {
  private readonly photoBucket = 'client-photos';

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async photoUrl(actor: AuthenticatedActor, id: string) {
    const client = await this.get(actor, id);
    return {
      url: client.photoStorageKey
        ? await this.storage.signedUrl(client.photoStorageKey, 300, this.photoBucket)
        : null,
    };
  }

  async uploadPhoto(actor: AuthenticatedActor, id: string, file?: Express.Multer.File) {
    const before = await this.get(actor, id);
    if (!file?.buffer?.length) throw new BadRequestException('Selecione uma foto.');
    const buffer = file.buffer;
    const jpeg =
      buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const png =
      buffer.length > 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp =
      buffer.length > 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP';
    const mimeType = jpeg ? 'image/jpeg' : png ? 'image/png' : webp ? 'image/webp' : null;
    if (!mimeType || buffer.length > 5 * 1024 * 1024)
      throw new BadRequestException('Use uma foto JPG, PNG ou WebP de até 5 MB.');
    const key = `${actor.organizationId}/clients/${id}/${randomUUID()}.${jpeg ? 'jpg' : png ? 'png' : 'webp'}`;
    await this.storage.upload(key, buffer, mimeType, this.photoBucket);
    try {
      await this.prisma.$transaction(async (transaction) => {
        const result = await transaction.client.updateMany({
          where: {
            id,
            organizationId: actor.organizationId,
            deletedAt: null,
            photoStorageKey: before.photoStorageKey,
          },
          data: { photoStorageKey: key },
        });
        if (result.count !== 1)
          throw new ConflictException('A foto foi alterada em outra sessão. Atualize a ficha.');
        await this.audit.record(transaction, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          actorSessionId: actor.sessionId,
          action: 'UPDATE',
          resource: 'client_photo',
          resourceId: id,
          metadata: { operation: 'upload' },
        });
      });
    } catch (error) {
      await this.storage.remove(key, this.photoBucket);
      throw error;
    }
    if (before.photoStorageKey) await this.storage.remove(before.photoStorageKey, this.photoBucket);
    return { url: await this.storage.signedUrl(key, 300, this.photoBucket) };
  }

  async removePhoto(actor: AuthenticatedActor, id: string) {
    const before = await this.get(actor, id);
    if (!before.photoStorageKey) return { url: null };
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.client.updateMany({
        where: {
          id,
          organizationId: actor.organizationId,
          deletedAt: null,
          photoStorageKey: before.photoStorageKey,
        },
        data: { photoStorageKey: null },
      });
      if (result.count !== 1)
        throw new ConflictException('A foto foi alterada em outra sessão. Atualize a ficha.');
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'DELETE',
        resource: 'client_photo',
        resourceId: id,
      });
    });
    await this.storage.remove(before.photoStorageKey, this.photoBucket);
    return { url: null };
  }

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
    if (actor.clientId && actor.clientId !== id)
      throw new NotFoundException('Cliente não encontrado');
    const client = await this.prisma.client.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        deletedAt: null,
      },
      include: { contacts: true },
    });
    if (!client) throw new NotFoundException('Cliente não encontrado');
    return client;
  }

  async overview(actor: AuthenticatedActor, id: string) {
    if (actor.clientId && actor.clientId !== id)
      throw new NotFoundException('Cliente não encontrado');
    const scope = { organizationId: actor.organizationId, clientId: id };
    const can = (permission: (typeof actor.permissions)[number]) =>
      actor.permissions.includes(permission);
    const clientOverviewInclude = {
      contacts: true,
      ...(can('matters:view')
        ? {
            matters: {
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
              orderBy: { updatedAt: 'desc' as const },
              take: 20,
            },
          }
        : {}),
      ...(can('contracts:view')
        ? {
            contracts: {
              where: scope,
              select: {
                id: true,
                number: true,
                title: true,
                status: true,
                feeModel: true,
                fixedAmount: true,
                successRate: true,
                currency: true,
                serviceName: true,
                terms: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'desc' as const },
              take: 20,
            },
          }
        : {}),
      ...(can('receivables:view')
        ? {
            receivables: {
              where: scope,
              select: {
                id: true,
                reference: true,
                description: true,
                status: true,
                contractId: true,
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
              orderBy: { dueDate: 'asc' as const },
            },
          }
        : {}),
      ...(can('payments:view')
        ? {
            payments: {
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
              orderBy: { paidAt: 'desc' as const },
              take: 20,
            },
          }
        : {}),
      ...(can('documents:view')
        ? {
            documents: {
              where: {
                ...scope,
                deletedAt: null,
                ...(actor.clientId ? { visibility: 'CLIENT' as const } : {}),
              },
              select: {
                id: true,
                title: true,
                category: true,
                contractId: true,
                visibility: true,
                updatedAt: true,
              },
              orderBy: { updatedAt: 'desc' as const },
              take: 20,
            },
          }
        : {}),
      ...(can('tasks:view')
        ? {
            tasks: {
              where: { ...scope, deletedAt: null },
              select: { id: true, title: true, status: true, priority: true, dueAt: true },
              orderBy: { dueAt: 'asc' as const },
              take: 20,
            },
          }
        : {}),
      ...(can('calendar:view')
        ? {
            calendarEvents: {
              where: { ...scope, startsAt: { gte: new Date() } },
              select: {
                id: true,
                title: true,
                type: true,
                startsAt: true,
                endsAt: true,
                timezone: true,
              },
              orderBy: { startsAt: 'asc' as const },
              take: 20,
            },
          }
        : {}),
      ...(can('notes:view')
        ? {
            internalNotes: {
              where: { ...scope, deletedAt: null },
              select: { id: true, body: true, createdAt: true, createdById: true },
              orderBy: { createdAt: 'desc' as const },
              take: 20,
            },
          }
        : {}),
      ...(can('messages:view')
        ? {
            clientMessages: {
              where: { ...scope, deletedAt: null },
              select: { id: true, body: true, publishedAt: true, createdById: true },
              orderBy: { publishedAt: 'desc' as const },
              take: 20,
            },
          }
        : {}),
    } as const satisfies Prisma.ClientInclude;
    const { clientRecord, timeline } = await this.prisma.$transaction(
      async (transaction) => {
        const clientRecord = (await transaction.client.findFirst({
          where: { id, organizationId: actor.organizationId, deletedAt: null },
          relationLoadStrategy: 'join',
          include: clientOverviewInclude,
        })) as Prisma.ClientGetPayload<{ include: typeof clientOverviewInclude }> | null;
        if (!clientRecord) throw new NotFoundException('Cliente não encontrado');
        const timeline = can('audit:view')
          ? await transaction.activityEvent.findMany({
              where: {
                organizationId: actor.organizationId,
                subjectType: 'client',
                subjectId: id,
              },
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
            })
          : [];
        return { clientRecord, timeline };
      },
      { maxWait: 10_000, timeout: 10_000 },
    );

    const {
      contacts,
      matters = [],
      contracts = [],
      receivables: loadedReceivables = [],
      payments = [],
      documents = [],
      tasks = [],
      calendarEvents: events = [],
      internalNotes: notes = [],
      clientMessages: messages = [],
      ...client
    } = clientRecord;
    const balanceReceivables = loadedReceivables as unknown as OverviewReceivable[];
    const receivables = balanceReceivables.slice(0, 50);
    const outstanding = calculateOutstandingByCurrency(
      balanceReceivables.map((receivable) => ({
        currency: receivable.currency,
        status: receivable.status,
        installments: receivable.installments.map((installment) => ({
          amount: installment.amount.toString(),
          status: installment.status,
          allocations: installment.allocations.map(({ amount }) => ({ amount: amount.toString() })),
          adjustments: installment.adjustments.map(({ amount, kind }) => ({
            amount: amount.toString(),
            kind,
          })),
        })),
      })),
    );
    return {
      client: { ...client, contacts },
      contacts,
      matters,
      contracts,
      financial: {
        receivables,
        payments,
        outstanding,
      },
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
    try {
      return await this.prisma.$transaction(async (transaction) => {
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
    } catch (error) {
      if (
        taxIdNormalized &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        Array.isArray(error.meta?.target) &&
        error.meta.target.includes('tax_id_normalized')
      ) {
        throw new ConflictException('Este CPF/CNPJ já está cadastrado nesta organização.');
      }
      throw error;
    }
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
