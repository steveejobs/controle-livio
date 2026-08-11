import { z } from 'zod';

const postgresqlUrl = z
  .string()
  .url()
  .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol), {
    message: 'DATABASE_URL deve usar PostgreSQL',
  });

const baseEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const apiEnvironmentSchema = baseEnvironmentSchema
  .extend({
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    DATABASE_URL: postgresqlUrl,
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    SUPABASE_ENVIRONMENT: z.enum(['development', 'test', 'staging', 'production']).optional(),
    SUPABASE_PROJECT_REF: z
      .string()
      .regex(/^[a-z0-9-]{8,40}$/)
      .optional(),
    CONFIRM_SUPABASE_PROJECT_REF: z
      .string()
      .regex(/^[a-z0-9-]{8,40}$/)
      .optional(),
    SUPABASE_LOCAL: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((value) => value === true || value === 'true')
      .default(false),
    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string().min(20),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    SUPABASE_AUTH_REDIRECT_URL: z.string().url().default('http://localhost:3000/auth/confirm'),
    STORAGE_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
    MAX_DOCUMENT_SIZE_MB: z.coerce.number().int().min(1).max(100).default(20),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
    SMTP_SECURE: z.coerce.boolean().default(true),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMTP_FROM: z.string().email().optional(),
    TRUST_PROXY: z.coerce.boolean().default(false),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .superRefine((environment, context) => {
    const origins = environment.CORS_ORIGINS.split(',').map((origin) => origin.trim());
    if (origins.some((origin) => origin === '*')) {
      context.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS não permite wildcard',
      });
    }
    if (
      environment.SUPABASE_PROJECT_REF &&
      environment.SUPABASE_PROJECT_REF !== environment.CONFIRM_SUPABASE_PROJECT_REF
    ) {
      context.addIssue({
        code: 'custom',
        path: ['CONFIRM_SUPABASE_PROJECT_REF'],
        message: 'Project ref Supabase nao confirmado',
      });
    }
    const databaseHost = new URL(environment.DATABASE_URL).hostname;
    const supabaseHost = new URL(environment.SUPABASE_URL).hostname;
    const expectedProjectRef = environment.SUPABASE_PROJECT_REF ?? supabaseHost.split('.')[0];
    const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
    if (
      environment.SUPABASE_LOCAL &&
      (environment.SUPABASE_ENVIRONMENT === 'production' ||
        !localHosts.has(databaseHost) ||
        !localHosts.has(supabaseHost))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SUPABASE_LOCAL'],
        message: 'Stack Supabase local exige host local e ambiente nao produtivo',
      });
    }
    if (
      !environment.SUPABASE_LOCAL &&
      (!environment.DATABASE_URL.includes('supabase') ||
        !environment.DATABASE_URL.includes(expectedProjectRef ?? 'invalid-project-ref'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL deve apontar para o projeto Supabase confirmado',
      });
    }
    if (
      !environment.SUPABASE_LOCAL &&
      !environment.SUPABASE_URL.includes(expectedProjectRef ?? 'invalid-project-ref')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SUPABASE_URL'],
        message: 'SUPABASE_URL deve corresponder ao project ref confirmado',
      });
    }
  });

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;

export function parseApiEnvironment(values: Record<string, unknown>): ApiEnvironment {
  return apiEnvironmentSchema.parse(values);
}

export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
