import { z } from 'zod';

export const reportRangeSchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    groupBy: z.enum(['day', 'week', 'month']).default('day'),
  })
  .refine((value) => value.to >= value.from, { message: 'Período inválido', path: ['to'] });

export const reportNameSchema = z.enum([
  'receivables-due',
  'received',
  'accrual',
  'overdue',
  'aging',
  'cash-forecast',
  'partial-payments',
  'active-contracts',
  'revenue-by-lawyer',
  'revenue-by-service',
  'delinquent-clients',
  'reconciliation',
]);

export type ReportRange = z.infer<typeof reportRangeSchema>;
export type ReportName = z.infer<typeof reportNameSchema>;
