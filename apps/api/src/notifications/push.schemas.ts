import { z } from 'zod';

const pushServiceHosts = [
  'fcm.googleapis.com',
  'push.apple.com',
  'push.services.mozilla.com',
  'notify.windows.com',
];

const endpointSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      pushServiceHosts.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
    );
  }, 'O endpoint deve ser HTTPS de um serviço de push compatível');

export const pushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
  expirationTime: z.number().finite().nonnegative().nullable().optional(),
  keys: z.object({
    p256dh: z
      .string()
      .min(16)
      .max(255)
      .regex(/^[A-Za-z0-9_-]+$/),
    auth: z
      .string()
      .min(16)
      .max(255)
      .regex(/^[A-Za-z0-9_-]+$/),
  }),
});

export const deletePushSubscriptionSchema = z.object({ endpoint: endpointSchema });

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
export type DeletePushSubscriptionInput = z.infer<typeof deletePushSubscriptionSchema>;
