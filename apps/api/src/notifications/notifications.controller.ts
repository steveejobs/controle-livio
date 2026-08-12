import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { AuthenticatedActor } from '@livio/shared';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('reconcile')
  @RequirePermission('notifications:update')
  reconcile(@CurrentActor() actor: AuthenticatedActor) {
    return this.notifications.reconcileFinancialAlerts(actor);
  }

  @Get()
  @RequirePermission('notifications:view')
  list(@CurrentActor() actor: AuthenticatedActor) {
    return this.notifications.list(actor);
  }

  @Patch(':id/read')
  @RequirePermission('notifications:update')
  read(@CurrentActor() actor: AuthenticatedActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(actor, id);
  }
}
