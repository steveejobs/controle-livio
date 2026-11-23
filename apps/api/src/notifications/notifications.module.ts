import { Module } from '@nestjs/common';
import { StorageRecoveryModule } from '../storage-recovery/storage-recovery.module';
import { StorageRecoveryController } from '../storage-recovery/storage-recovery.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushNotificationsService } from './push-notifications.service';
import { ScheduledDispatchService } from './scheduled-dispatch.service';

@Module({
  imports: [StorageRecoveryModule],
  controllers: [NotificationsController, StorageRecoveryController],
  providers: [NotificationsService, PushNotificationsService, ScheduledDispatchService],
  exports: [NotificationsService, PushNotificationsService],
})
export class NotificationsModule {}
