import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@livio/db';
import type { AuthenticatedActor } from '@livio/shared';
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

  async create(actor: AuthenticatedActor, input: CreateMatterInput) {
    await this.assertReferences(actor.organizationId, input);
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
