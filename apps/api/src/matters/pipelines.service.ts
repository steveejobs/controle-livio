import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedActor } from '@livio/shared';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePipelineInput, CreateStageInput, UpdateStageInput } from './matter.schemas';

@Injectable()
export class PipelinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(actor: AuthenticatedActor) {
    return this.prisma.pipeline.findMany({
      where: { organizationId: actor.organizationId, isActive: true },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      include: { stages: { where: { isActive: true }, orderBy: { position: 'asc' } } },
    });
  }

  create(actor: AuthenticatedActor, input: CreatePipelineInput) {
    return this.prisma.$transaction(async (transaction) => {
      const pipeline = await transaction.pipeline.create({
        data: {
          organizationId: actor.organizationId,
          name: input.name,
          kind: input.kind,
          stages: {
            create: input.stages.map((stage) => ({
              organizationId: actor.organizationId,
              ...stage,
            })),
          },
        },
        include: { stages: { orderBy: { position: 'asc' } } },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CREATE',
        resource: 'pipeline',
        resourceId: pipeline.id,
        after: pipeline,
      });
      return pipeline;
    });
  }

  async addStage(actor: AuthenticatedActor, pipelineId: string, input: CreateStageInput) {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id: pipelineId, organizationId: actor.organizationId },
    });
    if (!pipeline) throw new NotFoundException('Pipeline não encontrado');
    return this.prisma.$transaction(async (transaction) => {
      const stage = await transaction.pipelineStage.create({
        data: { organizationId: actor.organizationId, pipelineId, ...input },
      });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'CREATE',
        resource: 'pipeline_stage',
        resourceId: stage.id,
        after: stage,
      });
      return stage;
    });
  }

  async updateStage(
    actor: AuthenticatedActor,
    pipelineId: string,
    stageId: string,
    input: UpdateStageInput,
  ) {
    const before = await this.prisma.pipelineStage.findFirst({
      where: { id: stageId, pipelineId, organizationId: actor.organizationId },
    });
    if (!before) throw new NotFoundException('Etapa não encontrada');
    return this.prisma.$transaction(async (transaction) => {
      const stage = await transaction.pipelineStage.update({ where: { id: stageId }, data: input });
      await this.audit.record(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorSessionId: actor.sessionId,
        action: 'UPDATE',
        resource: 'pipeline_stage',
        resourceId: stage.id,
        before,
        after: stage,
      });
      return stage;
    });
  }
}
