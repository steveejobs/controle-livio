import { timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@livio/shared';
import type { AuthenticatedActor } from '@livio/shared';
import { CurrentActor } from '../auth/current-actor.decorator';
import { Public } from '../auth/public.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<ApiEnvironment, true>,
  ) {}

  @Get('cron')
  @Public()
  cron(@Headers('authorization') authorization?: string) {
    const secret = this.config.get('CRON_SECRET', { infer: true });
    if (!secret) throw new ServiceUnavailableException('Rotina automática não configurada');
    const expected = Buffer.from(`Bearer ${secret}`);
    const received = Buffer.from(authorization ?? '');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new UnauthorizedException('Credencial da rotina inválida');
    }
    return this.notifications.reconcileAllFinancialAlerts();
  }

  @Post('reconcile')
  @RequirePermission('notifications:update')
  reconcile(@CurrentActor() actor: AuthenticatedActor) {
    return this.notifications.reconcileUserAlerts(actor);
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
