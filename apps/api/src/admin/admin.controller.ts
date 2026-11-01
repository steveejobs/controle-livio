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
  accessAlertSettingsSchema,
  type CreateRoleInput,
  type CreateUserInput,
  type UserStatusInput,
  type AccessAlertSettingsInput,
} from './admin.schemas';
import { RequireAdministrator } from '../auth/require-administrator.decorator';

@ApiTags('Administração')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}
  @Get('users') @RequirePermission('users:view') users(@CurrentActor() actor: AuthenticatedActor) {
    return this.admin.listUsers(actor);
  }
  @Post('users') @RequirePermission('users:manage') @RequireAdministrator() createUser(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(createUserSchema)) input: CreateUserInput,
  ) {
    return this.admin.createUser(actor, input);
  }
  @Patch('users/:id/status') @RequirePermission('users:manage') @RequireAdministrator() status(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(userStatusSchema)) input: UserStatusInput,
  ) {
    return this.admin.setUserStatus(actor, id, input);
  }
  @Post('users/:id/recovery-link')
  @RequirePermission('users:manage')
  @RequireAdministrator()
  recoveryLink(@CurrentActor() actor: AuthenticatedActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.createRecoveryLink(actor, id);
  }
  @Get('roles') @RequirePermission('roles:view') roles(@CurrentActor() actor: AuthenticatedActor) {
    return this.admin.listRoles(actor);
  }
  @Post('system-roles/reconcile')
  @RequirePermission('roles:manage')
  @RequireAdministrator()
  reconcileRoles(@CurrentActor() actor: AuthenticatedActor) {
    return this.admin.reconcileSystemRoles(actor);
  }
  @Post('roles') @RequirePermission('roles:manage') @RequireAdministrator() createRole(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(createRoleSchema)) input: CreateRoleInput,
  ) {
    return this.admin.createRole(actor, input);
  }

  @Get('access-alerts')
  @RequirePermission('organization:view')
  @RequireAdministrator()
  accessAlerts(@CurrentActor() actor: AuthenticatedActor) {
    return this.admin.getAccessAlertSettings(actor);
  }

  @Patch('access-alerts')
  @RequirePermission('organization:update')
  @RequireAdministrator()
  updateAccessAlerts(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(accessAlertSettingsSchema)) input: AccessAlertSettingsInput,
  ) {
    return this.admin.updateAccessAlertSettings(actor, input);
  }
}
