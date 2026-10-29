import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
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
import { PushNotificationsService } from './push-notifications.service';
import {
  deletePushSubscriptionSchema,
  pushSubscriptionSchema,
  type DeletePushSubscriptionInput,
  type PushSubscriptionInput,
} from './push.schemas';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ScheduledDispatchService } from './scheduled-dispatch.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly pushNotifications: PushNotificationsService,
    private readonly config: ConfigService<ApiEnvironment, true>,
    private readonly scheduledDispatch: ScheduledDispatchService,
  ) {}

  @Get('push/config')
  @RequirePermission('notifications:update')
  pushConfig(@CurrentActor() actor: AuthenticatedActor) {
    return this.pushNotifications.publicConfig(actor);
  }

  @Post('push-subscriptions')
  @RequirePermission('notifications:update')
  subscribeToPush(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(pushSubscriptionSchema)) input: PushSubscriptionInput,
  ) {
    return this.pushNotifications.subscribe(actor, input);
  }

  @Post('push/test')
  @RequirePermission('notifications:update')
  testPush(@CurrentActor() actor: AuthenticatedActor) {
    return this.pushNotifications.test(actor);
  }

  @Delete('push-subscriptions')
  @RequirePermission('notifications:update')
  unsubscribeFromPush(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(deletePushSubscriptionSchema)) input: DeletePushSubscriptionInput,
  ) {
    return this.pushNotifications.unsubscribe(actor, input.endpoint);
  }

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

  @Get('hearing-alerts/cron')
  @Public()
  hearingAlertsCron(@Headers('authorization') authorization?: string) {
    const secret = this.config.get('CRON_SECRET', { infer: true });
    if (!secret) throw new ServiceUnavailableException('Rotina automática não configurada');
    const expected = Buffer.from(`Bearer ${secret}`);
    const received = Buffer.from(authorization ?? '');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new UnauthorizedException('Credencial da rotina inválida');
    }
    return this.notifications.reconcileHearingReminders();
  }

  @Get('dispatch/cron')
  @Public()
  dispatchCron(
    @Headers('x-livio-scheduled-at') timestamp?: string,
    @Headers('x-livio-signature') signature?: string,
  ) {
    return this.scheduledDispatch.run(timestamp, signature);
  }

  @Get('access-alerts/cron')
  @Public()
  accessAlertsCron(@Headers('authorization') authorization?: string) {
    const secret = this.config.get('CRON_SECRET', { infer: true });
    if (!secret) throw new ServiceUnavailableException('Rotina automática não configurada');
    const expected = Buffer.from(`Bearer ${secret}`);
    const received = Buffer.from(authorization ?? '');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new UnauthorizedException('Credencial da rotina inválida');
    }
    return this.notifications.reconcileAccessDigests();
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
