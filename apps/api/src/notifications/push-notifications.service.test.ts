import type { AuthenticatedActor } from '@livio/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import webPush from 'web-push';
import { PushNotificationsService } from './push-notifications.service';

vi.mock('web-push', () => ({ default: { sendNotification: vi.fn() } }));

const actor: AuthenticatedActor = {
  userId: 'user-a',
  sessionId: 'session-a',
  organizationId: 'org-a',
  permissions: ['notifications:update'],
};

const vapidValues = {
  VAPID_PUBLIC_KEY: 'public-vapid-key-that-is-long-enough',
  VAPID_PRIVATE_KEY: 'private-vapid-key-that-is-long-enough',
  VAPID_SUBJECT: 'mailto:suporte@example.com',
};

function serviceWith(prisma: Record<string, unknown>, values = vapidValues) {
  const config = { get: vi.fn((key: keyof typeof values) => values[key]) };
  return new PushNotificationsService(prisma as never, config as never);
}

describe('PushNotificationsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the public key and only subscriptions belonging to the current user', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ endpoint: 'https://fcm.googleapis.com/device-a' }]);
    const service = serviceWith({ webPushSubscription: { findMany } });

    await expect(service.publicConfig(actor)).resolves.toEqual({
      enabled: true,
      publicKey: vapidValues.VAPID_PUBLIC_KEY,
      subscriptions: ['https://fcm.googleapis.com/device-a'],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a', userId: 'user-a' },
      select: { endpoint: true },
    });
  });

  it('binds a device subscription to the authenticated account and organization', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const service = serviceWith({ webPushSubscription: { upsert } });
    const input = {
      endpoint: 'https://fcm.googleapis.com/device-a',
      keys: {
        p256dh: 'abcdefghijklmnopqrstuvwxyz123456',
        auth: 'abcdefghijklmnopqrstuvwxyz123456',
      },
    };

    await expect(service.subscribe(actor, input)).resolves.toEqual({ enabled: true });
    expect(upsert).toHaveBeenCalledWith({
      where: { endpoint: input.endpoint },
      create: {
        organizationId: 'org-a',
        userId: 'user-a',
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
      update: {
        organizationId: 'org-a',
        userId: 'user-a',
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
    });
  });

  it('sends generic notifications only to subscriptions in the target organization', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'subscription-a',
        organizationId: 'org-a',
        userId: 'user-a',
        endpoint: 'https://fcm.googleapis.com/device-a',
        p256dh: 'public-key',
        auth: 'auth-secret',
      },
    ]);
    vi.mocked(webPush.sendNotification).mockResolvedValue({ statusCode: 201 } as never);
    const service = serviceWith({ webPushSubscription: { findMany, deleteMany: vi.fn() } });

    await expect(
      service.notifyUsers('org-a', ['user-a', 'user-a'], {
        title: 'Novo alerta financeiro',
        body: 'Entre no Lívio para conferir os vencimentos.',
      }),
    ).resolves.toEqual({ sent: 1 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-a', userId: { in: ['user-a'] } } }),
    );
    const payload = JSON.parse(vi.mocked(webPush.sendNotification).mock.calls[0]![1]!) as {
      body: string;
    };
    expect(payload.body).not.toContain('CPF');
  });

  it('removes expired endpoints and contains push-provider failures', async () => {
    const subscription = {
      id: 'subscription-a',
      organizationId: 'org-a',
      userId: 'user-a',
      endpoint: 'https://fcm.googleapis.com/device-a',
      p256dh: 'public-key',
      auth: 'auth-secret',
    };
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    vi.mocked(webPush.sendNotification).mockRejectedValue({ statusCode: 410 });
    const service = serviceWith({
      webPushSubscription: { findMany: vi.fn().mockResolvedValue([subscription]), deleteMany },
    });

    await expect(
      service.notifyUsers('org-a', ['user-a'], { title: 'Aviso', body: 'Abra o Lívio.' }),
    ).resolves.toEqual({ sent: 0 });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'subscription-a', organizationId: 'org-a', userId: 'user-a' },
    });

    const failingService = serviceWith({
      webPushSubscription: {
        findMany: vi.fn().mockRejectedValue(new Error('database unavailable')),
      },
    });
    await expect(
      failingService.notifyUsers('org-a', ['user-a'], { title: 'Aviso', body: 'Abra o Lívio.' }),
    ).resolves.toEqual({ sent: 0 });
  });
});
