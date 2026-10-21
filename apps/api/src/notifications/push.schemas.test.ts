import { describe, expect, it } from 'vitest';
import { deletePushSubscriptionSchema, pushSubscriptionSchema } from './push.schemas';

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/example-token',
  expirationTime: null,
  keys: {
    p256dh: 'abcdefghijklmnopqrstuvwxyz123456',
    auth: 'abcdefghijklmnopqrstuvwxyz123456',
  },
};

describe('push subscription schemas', () => {
  it('accepts a browser subscription from a supported HTTPS push service', () => {
    expect(pushSubscriptionSchema.safeParse(subscription).success).toBe(true);
    expect(
      deletePushSubscriptionSchema.safeParse({ endpoint: 'https://web.push.apple.com/example' })
        .success,
    ).toBe(true);
  });

  it('rejects insecure or untrusted endpoints and malformed keys', () => {
    expect(
      pushSubscriptionSchema.safeParse({
        ...subscription,
        endpoint: 'http://fcm.googleapis.com/fcm/send/example-token',
      }).success,
    ).toBe(false);
    expect(
      deletePushSubscriptionSchema.safeParse({ endpoint: 'https://127.0.0.1/internal' }).success,
    ).toBe(false);
    expect(
      pushSubscriptionSchema.safeParse({
        ...subscription,
        keys: { ...subscription.keys, auth: '***' },
      }).success,
    ).toBe(false);
  });
});
