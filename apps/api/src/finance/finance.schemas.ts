import { z } from 'zod';

export const moneySchema = z
  .string()
  .regex(/^\d{1,15}(\.\d{1,4})?$/, 'Use valor decimal positivo como string');

export const createContractSchema = z.object({
  clientId: z.string().uuid(),
  matterId: z.string().uuid().optional(),
  number: z.string().trim().min(1).max(80),
  title: z.string().trim().min(2).max(240),
  feeModel: z.string().trim().min(2).max(80),
  fixedAmount: moneySchema.optional(),
  successRate: z
    .string()
    .regex(/^0(\.\d{1,6})?$|^1(\.0{1,6})?$/)
    .optional(),
  currency: z.string().length(3).default('BRL'),
  serviceCode: z.string().trim().max(80).optional(),
  serviceName: z.string().trim().max(160).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
});

const installmentSchema = z.object({
  sequence: z.number().int().min(1),
  amount: moneySchema,
  dueDate: z.coerce.date(),
  competenceDate: z.coerce.date().optional(),
});

export const createReceivableSchema = z.object({
  clientId: z.string().uuid(),
  matterId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  reference: z.string().trim().min(1).max(80),
  description: z.string().trim().min(2).max(500),
  originalAmount: moneySchema,
  currency: z.string().length(3).default('BRL'),
  issueDate: z.coerce.date(),
  competenceDate: z.coerce.date().optional(),
  installments: z.array(installmentSchema).min(1).max(240),
});

export const createPaymentSchema = z
  .object({
    clientId: z.string().uuid(),
    reference: z.string().trim().min(1).max(100),
    amount: moneySchema,
    currency: z.string().length(3).default('BRL'),
    paidAt: z.coerce.date(),
    method: z.string().trim().min(2).max(80),
    externalId: z.string().trim().max(160).optional(),
    allocations: z
      .array(z.object({ installmentId: z.string().uuid(), amount: moneySchema }))
      .max(240)
      .default([]),
  })
  .superRefine((value, context) => {
    if (
      new Set(value.allocations.map(({ installmentId }) => installmentId)).size !==
      value.allocations.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['allocations'],
        message: 'Uma parcela não pode aparecer duas vezes',
      });
    }
  });

export const adjustmentSchema = z.object({
  kind: z.enum(['DISCOUNT', 'INTEREST', 'PENALTY', 'CORRECTION', 'REVERSAL', 'OTHER']),
  amount: moneySchema,
  reason: z.string().trim().min(3).max(500),
  effectiveAt: z.coerce.date(),
});

export const reversalSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const renegotiationSchema = z.object({
  reference: z.string().trim().min(1).max(80),
  description: z.string().trim().min(2).max(500),
  reason: z.string().trim().min(3).max(500),
  issueDate: z.coerce.date(),
  competenceDate: z.coerce.date().optional(),
  installments: z.array(installmentSchema).min(1).max(240),
});

export const createExpenseSchema = z.object({
  clientId: z.string().uuid().optional(),
  matterId: z.string().uuid().optional(),
  description: z.string().trim().min(2).max(500),
  category: z.string().trim().min(2).max(100),
  amount: moneySchema,
  currency: z.string().length(3).default('BRL'),
  incurredAt: z.coerce.date(),
  dueDate: z.coerce.date().optional(),
  reimbursable: z.boolean().default(false),
});

export const financeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  clientId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  status: z.string().max(40).optional(),
});

export type CreateContractInput = z.infer<typeof createContractSchema>;
export type CreateReceivableInput = z.infer<typeof createReceivableSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type ReversalInput = z.infer<typeof reversalSchema>;
export type RenegotiationInput = z.infer<typeof renegotiationSchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type FinanceListQuery = z.infer<typeof financeListQuerySchema>;
