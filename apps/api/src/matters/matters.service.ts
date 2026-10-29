import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@livio/db';
import type { AuthenticatedActor, PermissionCode } from '@livio/shared';
import { AuditService } from '../common/audit.service';
import { normalizeCourtNumber } from '../common/security';
import { normalizeAndValidateTaxId } from '../common/tax-id';
import { pageResult, pageWindow, type PaginationInput } from '../common/schemas';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateMatterInput,
  CreateMatterPartyInput,
  MoveMatterInput,
  UpdateMatterInput,
} from './matter.schemas';

@Injectable()
export class MattersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedActor, input: PaginationInput) {
    const search = input.search?.trim();
    const normalized = search ? normalizeCourtNumber(search) : undefined;
    const where = {
      organizationId: actor.organizationId,
      deletedAt: null,
      ...(actor.clientId ? { clientId: actor.clientId } : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search, mode: 'insensitive' as const } },
              { title: { contains: search, mode: 'insensitive' as const } },
              ...(normalized ? [{ courtNumberNormalized: { contains: normalized } }] : []),
              {
                client: {
                  is: {
                    OR: [
                      { displayName: { contains: search, mode: 'insensitive' as const } },
                      { email: { contains: search, mode: 'insensitive' as const } },
                      { phone: { contains: search } },
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
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.matter.findMany({
        where,
        ...pageWindow(input),
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
        include: {
          client: { select: { id: true, displayName: true } },
          currentStage: true,
          pipeline: true,
        },
      }),
      this.prisma.matter.count({ where }),
    ]);
    return pageResult(items, total, input);
  }

  async get(actor: AuthenticatedActor, id: string) {
    const matter = await this.prisma.matter.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(actor.clientId ? { clientId: actor.clientId } : {}),
      },
      include: {
        client: true,
        parties: true,
        pipeline: true,
        currentStage: true,
        stageHistory: { orderBy: { movedAt: 'desc' }, include: { fromStage: true, toStage: true } },
      },
    });
    if (!matter) throw new NotFoundException('Processo não encontrado');
    return matter;
  }

  async timeline(actor: AuthenticatedActor, id: string) {
    const matter = await this.prisma.matter.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(actor.clientId ? { clientId: actor.clientId } : {}),
      },
      select: {
        id: true,
        reference: true,
        title: true,
        courtNumberNormalized: true,
        area: true,
        status: true,
        client: { select: { id: true, displayName: true } },
        stageHistory: {
          orderBy: { movedAt: 'desc' },
          take: 100,
          include: { fromStage: true, toStage: true },
        },
      },
    });
    if (!matter) throw new NotFoundException('Processo não encontrado');
    const canView = (permission: PermissionCode) => actor.permissions.includes(permission);
    const [tasks, events, notes, documents, messages] = await Promise.all([
      canView('tasks:view')
        ? this.prisma.task.findMany({
            where: { organizationId: actor.organizationId, matterId: id, deletedAt: null },
            take: 50,
            orderBy: { updatedAt: 'desc' },
            select: {
              id: true,
              title: true,
              status: true,
              dueAt: true,
              createdAt: true,
              history: {
                select: { id: true, action: true, createdAt: true, before: true, after: true },
                take: 10,
                orderBy: { createdAt: 'desc' },
              },
            },
          })
        : [],
      canView('calendar:view')
        ? this.prisma.calendarEvent.findMany({
            where: { organizationId: actor.organizationId, matterId: id },
            take: 50,
            orderBy: { startsAt: 'desc' },
            select: {
              id: true,
              title: true,
              type: true,
              status: true,
              startsAt: true,
              createdAt: true,
            },
          })
        : [],
      !actor.clientId && canView('notes:view')
        ? this.prisma.internalNote.findMany({
            where: { organizationId: actor.organizationId, matterId: id, deletedAt: null },
            take: 50,
            orderBy: { createdAt: 'desc' },
            select: { id: true, body: true, createdAt: true },
          })
        : [],
      canView('documents:view')
        ? this.prisma.document.findMany({
            where: {
              organizationId: actor.organizationId,
              matterId: id,
              deletedAt: null,
              ...(actor.clientId ? { visibility: 'CLIENT' as const } : {}),
            },
            take: 50,
            orderBy: { createdAt: 'desc' },
            select: { id: true, title: true, category: true, createdAt: true },
          })
        : [],
      canView('messages:view')
        ? this.prisma.clientMessage.findMany({
            where: { organizationId: actor.organizationId, matterId: id, deletedAt: null },
            take: 50,
            orderBy: { publishedAt: 'desc' },
            select: { id: true, body: true, publishedAt: true },
          })
        : [],
    ]);
    const entries = [
      ...matter.stageHistory.map((movement) => ({
        id: movement.id,
        type: 'STAGE',
        title: movement.fromStage
          ? `${movement.fromStage.name} → ${movement.toStage.name}`
          : `Processo criado em ${movement.toStage.name}`,
        description: movement.reason ?? undefined,
        occurredAt: movement.movedAt,
      })),
      ...tasks.flatMap((task) =>
        task.history.length
          ? task.history.map((history) => ({
              id: history.id,
              type: 'TASK',
              title: `${task.title} · ${history.action}`,
              description: task.dueAt ? `Prazo: ${task.dueAt.toISOString()}` : undefined,
              occurredAt: history.createdAt,
            }))
          : [
              {
                id: task.id,
                type: 'TASK',
                title: task.title,
                description: `Status: ${task.status}`,
                occurredAt: task.createdAt,
              },
            ],
      ),
      ...events.map((event) => ({
        id: event.id,
        type: event.type === 'HEARING' ? 'HEARING' : 'EVENT',
        title: event.title,
        description: `${event.type} · ${event.status}`,
        occurredAt: event.startsAt,
      })),
      ...notes.map((note) => ({
        id: note.id,
        type: 'NOTE',
        title: 'Nota interna',
        description: note.body,
        occurredAt: note.createdAt,
      })),
      ...documents.map((document) => ({
        id: document.id,
        type: 'DOCUMENT',
        title: document.title,
        description: document.category ?? undefined,
        occurredAt: document.createdAt,
      })),
      ...messages.map((message) => ({
        id: message.id,
        type: 'MESSAGE',
        title: 'Mensagem ao cliente',
        description: message.body,
        occurredAt: message.publishedAt,
      })),
    ].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());
    return {
      matter: {
        id: matter.id,
        reference: matter.reference,
        title: matter.title,
        courtNumberNormalized: matter.courtNumberNormalized,
        area: matter.area,
        status: matter.status,
        client: { id: matter.client.id, displayName: matter.client.displayName },
      },
      entries: entries.slice(0, 150),
    };
  }

  async create(actor: AuthenticatedActor, input: CreateMatterInput) {
    await this.assertReferences(actor.organizationId, input);
    if (input.collectionObjective) {
      const pipeline = input.pipelineId
        ? await this.prisma.pipeline.findFirst({
            where: { id: input.pipelineId, organizationId: actor.organizationId, isActive: true },
            select: { kind: true },
          })
        : null;
      if (pipeline?.kind !== 'COLLECTION') {
        throw new BadRequestException(
          'Objetivos sem valor financeiro só podem ser usados em cobranças',
        );
      }
    }
    return this.prisma.$transaction(async (transaction) => {
      const matter = await transaction.matter.create({
        data: {
          organizationId: actor.organizationId,
          clientId: input.clientId,
          reference: input.reference,
          title: input.title,
          status: input.status,
          priority: input.priority,
          labels: [...new Set(input.labels.map((label) => label.toLowerCase()))],
          confidential: input.confidential,
          ...(input.pipelineId ? { pipelineId: input.pipelineId } : {}),
          ...(input.currentStageId ? { currentStageId: input.currentStageId } : {}),
          ...(input.responsibleLawyerId ? { responsibleLawyerId: input.responsibleLawyerId } : {}),
          ...(input.responsibleSecretaryId
            ? { responsibleSecretaryId: input.responsibleSecretaryId }
            : {}),
          ...(input.description ? { description: input.description } : {}),
          ...(input.courtNumber
            ? { courtNumberNormalized: normalizeCourtNumber(input.courtNumber) }
            : {}),
          ...(input.area ? { area: input.area } : {}),
          ...(input.nextAction ? { nextAction: input.nextAction } : {}),
          ...(input.nextActionAt ? { nextActionAt: input.nextActionAt } : {}),
          ...(input.lostReason ? { lostReason: input.lostReason } : {}),
          ...(input.collectionObjective
            ? {
                customFields: {
                  collectionObjective: {
                    kind: 'NON_FINANCIAL',
                    description: input.collectionObjective.description,
                  },
                },
              }
            : {}),
        },
      });
      if (input.currentStageId) {
        await transaction.matterStageHistory.create({
          data: {
            organizationId: actor.organizationId,
            matterId: matter.id,
            toStageId: input.currentStageId,
            movedById: actor.userId,
          },
        });
      }
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CREATE',
        resource: 'matter',
        resourceId: matter.id,
        after: matter,
      });
      return matter;
    });
  }

  async update(actor: AuthenticatedActor, id: string, input: UpdateMatterInput) {
    const before = await this.get(actor, id);
    await this.assertReferences(actor.organizationId, input);
    const { courtNumber, labels, ...data } = input;
    return this.prisma.$transaction(async (transaction) => {
      const matter = await transaction.matter.update({
        where: { id },
        data: {
          ...data,
          ...(courtNumber !== undefined
            ? { courtNumberNormalized: courtNumber ? normalizeCourtNumber(courtNumber) : null }
            : {}),
          ...(labels ? { labels: [...new Set(labels.map((label) => label.toLowerCase()))] } : {}),
        },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'UPDATE',
        resource: 'matter',
        resourceId: id,
        before,
        after: matter,
      });
      return matter;
    });
  }

  async move(actor: AuthenticatedActor, id: string, input: MoveMatterInput) {
    return this.prisma.$transaction(
      async (transaction) => {
        const matter = await transaction.matter.findFirst({
          where: { id, organizationId: actor.organizationId, deletedAt: null },
        });
        if (!matter) throw new NotFoundException('Processo não encontrado');
        const stage = await transaction.pipelineStage.findFirst({
          where: {
            id: input.toStageId,
            organizationId: actor.organizationId,
            pipelineId: matter.pipelineId ?? undefined,
            isActive: true,
          },
        });
        if (!stage || !matter.pipelineId)
          throw new NotFoundException('Etapa não pertence ao pipeline do processo');
        if (matter.currentStageId === stage.id) return matter;
        const changed = await transaction.matter.updateMany({
          where: {
            id,
            organizationId: actor.organizationId,
            currentStageId: matter.currentStageId,
          },
          data: { currentStageId: stage.id },
        });
        if (changed.count !== 1)
          throw new ConflictException('O processo foi movimentado por outro usuário');
        const history = await transaction.matterStageHistory.create({
          data: {
            organizationId: actor.organizationId,
            matterId: id,
            fromStageId: matter.currentStageId,
            toStageId: stage.id,
            movedById: actor.userId,
            ...(input.reason ? { reason: input.reason } : {}),
          },
        });
        await this.audit.record(transaction, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          actorSessionId: actor.sessionId,
          action: 'MOVE',
          resource: 'matter',
          resourceId: id,
          before: { currentStageId: matter.currentStageId },
          after: { currentStageId: stage.id },
          metadata: { historyId: history.id },
        });
        return transaction.matter.findUniqueOrThrow({
          where: { id },
          include: { currentStage: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async addParty(actor: AuthenticatedActor, matterId: string, input: CreateMatterPartyInput) {
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!matter) throw new NotFoundException('Processo não encontrado');
    if (
      input.clientId &&
      !(await this.prisma.client.findFirst({
        where: { id: input.clientId, organizationId: actor.organizationId, deletedAt: null },
      }))
    ) {
      throw new NotFoundException('Cliente vinculado à parte não encontrado');
    }
    let taxIdNormalized: string | undefined;
    try {
      taxIdNormalized = normalizeAndValidateTaxId(input.taxId);
    } catch {
      throw new BadRequestException('CPF/CNPJ inválido');
    }
    return this.prisma.$transaction(async (transaction) => {
      const party = await transaction.matterParty.create({
        data: {
          organizationId: actor.organizationId,
          matterId,
          name: input.name,
          partyRole: input.partyRole,
          ...(input.clientId ? { clientId: input.clientId } : {}),
          ...(taxIdNormalized ? { taxIdNormalized } : {}),
          ...(input.side ? { side: input.side } : {}),
        },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CREATE',
        resource: 'matter_party',
        resourceId: party.id,
        after: party,
      });
      return party;
    });
  }

  async archive(actor: AuthenticatedActor, id: string): Promise<void> {
    const before = await this.get(actor, id);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.matter.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'ARCHIVED' },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'DELETE',
        resource: 'matter',
        resourceId: id,
        before,
      });
    });
  }

  private async assertReferences(organizationId: string, input: Partial<CreateMatterInput>) {
    if (input.clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: input.clientId, organizationId, deletedAt: null },
      });
      if (!client) throw new NotFoundException('Cliente não encontrado');
    }
    if (input.pipelineId) {
      const pipeline = await this.prisma.pipeline.findFirst({
        where: { id: input.pipelineId, organizationId, isActive: true },
      });
      if (!pipeline) throw new NotFoundException('Pipeline não encontrado');
    }
    if (input.currentStageId) {
      const stage = await this.prisma.pipelineStage.findFirst({
        where: { id: input.currentStageId, organizationId, pipelineId: input.pipelineId },
      });
      if (!stage) throw new NotFoundException('Etapa inválida');
    }
    const assignees = [input.responsibleLawyerId, input.responsibleSecretaryId].filter(
      (value): value is string => Boolean(value),
    );
    if (assignees.length) {
      const count = await this.prisma.user.count({
        where: { id: { in: assignees }, organizationId, status: 'ACTIVE', deletedAt: null },
      });
      if (count !== new Set(assignees).size) throw new NotFoundException('Responsável inválido');
    }
  }
}
