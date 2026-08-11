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
  createClientSchema,
  createContactSchema,
  updateClientSchema,
  updateContactSchema,
  type CreateClientInput,
  type CreateContactInput,
  type UpdateClientInput,
  type UpdateContactInput,
} from './client.schemas';
import { ClientsService } from './clients.service';

@ApiTags('Clientes')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequirePermission('clients:view')
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput,
  ) {
    return this.clients.list(actor, query);
  }

  @Get(':id')
  @RequirePermission('clients:view')
  get(@CurrentActor() actor: AuthenticatedActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.get(actor, id);
  }

  @Get(':id/overview')
  @RequirePermission('clients:view')
  overview(@CurrentActor() actor: AuthenticatedActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.overview(actor, id);
  }

  @Post()
  @RequirePermission('clients:create')
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(createClientSchema)) input: CreateClientInput,
  ) {
    return this.clients.create(actor, input);
  }

  @Patch(':id')
  @RequirePermission('clients:update')
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateClientSchema)) input: UpdateClientInput,
  ) {
    return this.clients.update(actor, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('clients:delete')
  archive(@CurrentActor() actor: AuthenticatedActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.archive(actor, id);
  }

  @Post(':clientId/contacts')
  @RequirePermission('clients:create')
  addContact(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body(new ZodValidationPipe(createContactSchema)) input: CreateContactInput,
  ) {
    return this.clients.addContact(actor, clientId, input);
  }

  @Patch(':clientId/contacts/:contactId')
  @RequirePermission('clients:update')
  updateContact(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body(new ZodValidationPipe(updateContactSchema)) input: UpdateContactInput,
  ) {
    return this.clients.updateContact(actor, clientId, contactId, input);
  }
}
