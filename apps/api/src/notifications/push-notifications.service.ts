import { randomUUID } from 'node:crypto';
import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment, AuthenticatedActor } from '@livio/shared';
import webPush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import type { PushSubscriptionInput } from './push.schemas';

export type PushPresentation = {
  title: string;
  body: string;
};

@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<ApiEnvironment, true>,
  ) {}

  async publicConfig(actor: AuthenticatedActor) {
    const vapid = this.vapidConfiguration();
    const subscriptions = await this.prisma.webPushSubscription.findMany({
      where: { organizationId: actor.organizationId, userId: actor.userId },
      select: { endpoint: true },
    });
    return {
      enabled: Boolean(vapid),
      ...(vapid ? { publicKey: vapid.publicKey } : {}),
      subscriptions: subscriptions.map(({ endpoint }) => endpoint),
    };
  }

  async subscribe(actor: AuthenticatedActor, input: PushSubscriptionInput) {
    if (!this.vapidConfiguration())
      throw new ConflictException('As notificações deste navegador ainda não estão configuradas');

    await this.prisma.webPushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        organizationId: actor.organizationId,
        userId: actor.userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
      update: {
        organizationId: actor.organizationId,
        userId: actor.userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
    });
    return { enabled: true };
  }

  async unsubscribe(actor: AuthenticatedActor, endpoint: string) {
    await this.prisma.webPushSubscription.deleteMany({
      where: { organizationId: actor.organizationId, userId: actor.userId, endpoint },
    });
    return { enabled: false };
  }

  async notifyUsers(
    organizationId: string,
    userIds: readonly string[],
    presentation: PushPresentation,
  ) {
    try {
      const vapid = this.vapidConfiguration();
      if (!vapid || !userIds.length) return { sent: 0 };

      const subscriptions = await this.prisma.webPushSubscription.findMany({
        where: { organizationId, userId: { in: [...new Set(userIds)] } },
        select: {
          id: true,
          organizationId: true,
          userId: true,
          endpoint: true,
          p256dh: true,
          auth: true,
        },
      });
      const payload = JSON.stringify({
        id: randomUUID(),
        title: presentation.title.slice(0, 80),
        body: presentation.body.slice(0, 160),
        url: '/',
      });
      let sent = 0;
      await Promise.all(
        subscriptions.map(async (subscription) => {
          try {
            await webPush.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
              },
              payload,
              {
                vapidDetails: vapid,
                TTL: 60 * 60,
                urgency: 'high',
                timeout: 4_000,
              },
            );
            sent += 1;
          } catch (error) {
            const statusCode = (error as { statusCode?: number }).statusCode;
            if (statusCode === 404 || statusCode === 410) {
              try {
                await this.prisma.webPushSubscription.deleteMany({
                  where: { id: subscription.id, organizationId, userId: subscription.userId },
                });
              } catch {
                this.logger.warn('Could not remove an expired push subscription');
              }
              return;
            }
            this.logger.warn(
              `Push notification delivery failed (status ${statusCode ?? 'unknown'})`,
            );
          }
        }),
      );
      return { sent };
    } catch (error) {
      this.logger.warn(
        `Push notification delivery could not be prepared (${error instanceof Error ? error.name : 'unknown error'})`,
      );
      return { sent: 0 };
    }
  }

  private vapidConfiguration() {
    const publicKey = this.config.get('VAPID_PUBLIC_KEY', { infer: true });
    const privateKey = this.config.get('VAPID_PRIVATE_KEY', { infer: true });
    const subject = this.config.get('VAPID_SUBJECT', { infer: true });
    if (!publicKey || !privateKey || !subject) return undefined;
    return { publicKey, privateKey, subject };
  }
}
