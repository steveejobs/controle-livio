import { z } from 'zod';

export const trackedModules = [
  'dashboard',
  'portal',
  'clients',
  'matters',
  'legal',
  'collection',
  'documents',
  'tasks',
  'calendar',
  'notifications',
  'contracts',
  'finance',
  'reports',
  'admin',
  'pipelines',
  'audit',
] as const;

export const moduleViewSchema = z.object({ module: z.enum(trackedModules) });
export const clientViewSchema = z.object({ clientId: z.string().uuid() });

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Informe uma data válida.')
  .optional();

export const auditQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    category: z.enum(['all', 'changes', 'access', 'navigation']).default('all'),
    actorUserId: z.string().uuid().optional(),
    search: z.string().trim().max(120).optional(),
    dateFrom: dateSchema,
    dateTo: dateSchema,
  })
  .superRefine((value, context) => {
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
      context.addIssue({
        code: 'custom',
        path: ['dateTo'],
        message: 'A data final deve ser igual ou posterior à data inicial.',
      });
    }
  });

export type AuditQuery = z.infer<typeof auditQuerySchema>;
export type TrackedModule = (typeof trackedModules)[number];
export type ModuleViewInput = z.infer<typeof moduleViewSchema>;
export type ClientViewInput = z.infer<typeof clientViewSchema>;
