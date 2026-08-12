import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@livio/shared';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminService } from './admin.service';
import {
  createRoleSchema,
  createUserSchema,
  userStatusSchema,
  type CreateRoleInput,
  type CreateUserInput,
  type UserStatusInput,
} from './admin.schemas';

@ApiTags('Administração')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}
  @Get('users') @RequirePermission('users:view') users(@CurrentActor() actor: AuthenticatedActor) {
    return this.admin.listUsers(actor);
  }
  @Post('users') @RequirePermission('users:manage') createUser(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(createUserSchema)) input: CreateUserInput,
  ) {
    return this.admin.createUser(actor, input);
  }
  @Patch('users/:id/status') @RequirePermission('users:manage') status(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(userStatusSchema)) input: UserStatusInput,
  ) {
    return this.admin.setUserStatus(actor, id, input);
  }
  @Get('roles') @RequirePermission('roles:view') roles(@CurrentActor() actor: AuthenticatedActor) {
    return this.admin.listRoles(actor);
  }
  @Post('system-roles/reconcile') @RequirePermission('roles:manage') reconcileRoles(
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.admin.reconcileSystemRoles(actor);
  }
  @Post('roles') @RequirePermission('roles:manage') createRole(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(createRoleSchema)) input: CreateRoleInput,
  ) {
    return this.admin.createRole(actor, input);
  }
}
