import { z } from 'zod';
import { permissionActions, permissionResources } from '@livio/shared';

export const createUserSchema = z.object({
  email: z
    .string()
    .email()
    .max(320)
    .transform((value) => value.trim().toLowerCase()),
  fullName: z.string().trim().min(2).max(200),
  clientId: z.string().uuid().optional(),
  roleIds: z.array(z.string().uuid()).min(1).max(20),
});

export const userStatusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']) });

export const accessAlertSettingsSchema = z
  .object({
    enabled: z.boolean(),
    times: z.array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)).max(5),
  })
  .superRefine(({ enabled, times }, context) => {
    if (new Set(times).size !== times.length) {
      context.addIssue({ code: 'custom', path: ['times'], message: 'Horários repetidos' });
    }
    if (times.some((time) => Number(time.slice(3)) % 5 !== 0)) {
      context.addIssue({ code: 'custom', path: ['times'], message: 'Use intervalos de 5 minutos' });
    }
    if (enabled && !times.length) {
      context.addIssue({ code: 'custom', path: ['times'], message: 'Defina ao menos um horário' });
    }
  });

export const createRoleSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  permissions: z
    .array(z.object({ resource: z.enum(permissionResources), action: z.enum(permissionActions) }))
    .max(300),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UserStatusInput = z.infer<typeof userStatusSchema>;
export type AccessAlertSettingsInput = z.infer<typeof accessAlertSettingsSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
