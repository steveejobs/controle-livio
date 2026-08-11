import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@livio/shared';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { paginationSchema, type PaginationInput } from '../common/schemas';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createMatterSchema,
  createMatterPartySchema,
  moveMatterSchema,
  updateMatterSchema,
  type CreateMatterInput,
  type CreateMatterPartyInput,
  type MoveMatterInput,
  type UpdateMatterInput,
} from './matter.schemas';
import { MattersService } from './matters.service';

@ApiTags('Processos')
@Controller('matters')
export class MattersController {
  constructor(private readonly matters: MattersService) {}

  @Get()
  @RequirePermission('matters:view')
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput,
  ) {
    return this.matters.list(actor, query);
  }

  @Get(':id')
  @RequirePermission('matters:view')
  get(@CurrentActor() actor: AuthenticatedActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.matters.get(actor, id);
  }

  @Post()
  @RequirePermission('matters:create')
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(createMatterSchema)) input: CreateMatterInput,
  ) {
    return this.matters.create(actor, input);
  }

  @Patch(':id')
  @RequirePermission('matters:update')
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateMatterSchema)) input: UpdateMatterInput,
  ) {
    return this.matters.update(actor, id, input);
  }

  @Post(':id/stage-movements')
  @RequirePermission('matters:update')
  move(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(moveMatterSchema)) input: MoveMatterInput,
  ) {
    return this.matters.move(actor, id, input);
  }

  @Post(':id/parties')
  @RequirePermission('matters:update')
  addParty(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createMatterPartySchema)) input: CreateMatterPartyInput,
  ) {
    return this.matters.addParty(actor, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('matters:delete')
  archive(@CurrentActor() actor: AuthenticatedActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.matters.archive(actor, id);
  }
}
