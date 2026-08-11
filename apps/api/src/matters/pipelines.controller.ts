import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@livio/shared';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createPipelineSchema,
  createStageSchema,
  updateStageSchema,
  type CreatePipelineInput,
  type CreateStageInput,
  type UpdateStageInput,
} from './matter.schemas';
import { PipelinesService } from './pipelines.service';

@ApiTags('Pipelines')
@Controller('pipelines')
export class PipelinesController {
  constructor(private readonly pipelines: PipelinesService) {}
  @Get() @RequirePermission('pipelines:view') list(@CurrentActor() actor: AuthenticatedActor) {
    return this.pipelines.list(actor);
  }
  @Post() @RequirePermission('pipelines:manage') create(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(createPipelineSchema)) input: CreatePipelineInput,
  ) {
    return this.pipelines.create(actor, input);
  }
  @Post(':pipelineId/stages') @RequirePermission('pipelines:manage') addStage(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('pipelineId', ParseUUIDPipe) pipelineId: string,
    @Body(new ZodValidationPipe(createStageSchema)) input: CreateStageInput,
  ) {
    return this.pipelines.addStage(actor, pipelineId, input);
  }
  @Patch(':pipelineId/stages/:stageId') @RequirePermission('pipelines:manage') updateStage(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('pipelineId', ParseUUIDPipe) pipelineId: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Body(new ZodValidationPipe(updateStageSchema)) input: UpdateStageInput,
  ) {
    return this.pipelines.updateStage(actor, pipelineId, stageId, input);
  }
}
