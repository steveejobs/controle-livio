import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushNotificationsService } from './push-notifications.service';
import { ScheduledDispatchService } from './scheduled-dispatch.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, PushNotificationsService, ScheduledDispatchService],
  exports: [NotificationsService, PushNotificationsService],
})
export class NotificationsModule {}
