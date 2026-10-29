import { z } from 'zod';

export const createServiceCatalogItemSchema = z.object({
  name: z.string().trim().min(2).max(160),
  area: z.enum(['GENERAL', 'CRIMINAL']).default('GENERAL'),
});

export const moneySchema = z
  .string()
  .regex(/^\d{1,15}(\.\d{1,4})?$/, 'Use valor decimal positivo como string');

const nonNullDateSchema = z
  .any()
  .refine((value) => value !== null, 'A data não pode ser removida')
  .pipe(z.coerce.date());

const hearingScheduleSchema = z
  .object({
    startsAt: z.coerce.date().refine((value) => value.getTime() > Date.now(), {
      message: 'A data e o horário da audiência devem estar no futuro',
    }),
    endsAt: z.coerce.date().optional(),
    location: z.string().trim().max(500).optional(),
    reminderMinutes: z
      .array(z.number().int().min(1).max(10_080))
      .max(8)
      .refine((values) => new Set(values).size === values.length, {
        message: 'Não repita o mesmo intervalo de aviso',
      })
      .optional(),
  })
  .refine((value) => !value.endsAt || value.endsAt > value.startsAt, {
    message: 'O fim deve ser posterior ao início da audiência',
    path: ['endsAt'],
  });

export const createContractSchema = z.object({
  clientId: z.string().uuid(),
  matterId: z.string().uuid().optional(),
  receivableId: z.string().uuid().optional(),
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
  serviceNames: z.array(z.string().trim().min(2).max(160)).max(25).default([]),
  hearings: z.array(hearingScheduleSchema).max(20).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
});

const installmentSchema = z.object({
  sequence: z.number().int().min(1),
  amount: moneySchema,
  dueDate: nonNullDateSchema,
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

export const paymentChangeSchema = z
  .object({
    reference: z.string().trim().min(1).max(100),
    amount: moneySchema,
    paidAt: z.coerce.date(),
    method: z.string().trim().min(2).max(80),
    externalId: z.string().trim().max(160).nullable().optional(),
    allocations: z
      .array(z.object({ installmentId: z.string().uuid(), amount: moneySchema }))
      .max(240),
    reason: z.string().trim().min(3).max(500),
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

export const paymentChangeDecisionSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

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
  responsibleUserId: z.string().uuid().optional(),
  description: z.string().trim().min(2).max(500),
  category: z.string().trim().min(2).max(100),
  amount: moneySchema,
  currency: z.string().length(3).default('BRL'),
  incurredAt: z.coerce.date(),
  dueDate: z.coerce.date(),
  reimbursable: z.boolean().default(false),
});

export const updateExpenseSchema = z
  .object({
    clientId: z.string().uuid().nullable().optional(),
    matterId: z.string().uuid().nullable().optional(),
    responsibleUserId: z.string().uuid().nullable().optional(),
    description: z.string().trim().min(2).max(500).optional(),
    category: z.string().trim().min(2).max(100).optional(),
    amount: moneySchema.optional(),
    currency: z.string().length(3).optional(),
    incurredAt: z.coerce.date().optional(),
    dueDate: nonNullDateSchema.optional(),
    reimbursable: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo para atualizar');

export const expenseListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    clientId: z.string().uuid().optional(),
    status: z
      .enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED'])
      .optional(),
    category: z.string().trim().min(1).max(100).optional(),
    period: z.enum(['incurredAt', 'dueDate', 'paidAt']).default('dueDate'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((value) => !value.from || !value.to || value.to >= value.from, {
    message: 'Período inválido',
    path: ['to'],
  });

export const expenseSummaryQuerySchema = z
  .object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })
  .refine((value) => !value.from || !value.to || value.to >= value.from, {
    message: 'Período inválido',
    path: ['to'],
  });

export const expenseHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

export const expensePaymentSchema = z.object({
  amount: moneySchema,
  paidAt: z.coerce.date(),
  method: z.string().trim().min(2).max(80),
  reference: z.string().trim().max(160).optional(),
});

export const expenseRejectionSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const expenseApprovalPolicySchema = z.object({ required: z.boolean() });

export const financeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  clientId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  status: z.string().max(40).optional(),
});

export type CreateContractInput = z.infer<typeof createContractSchema>;
export type CreateServiceCatalogItemInput = z.infer<typeof createServiceCatalogItemSchema>;
export type CreateReceivableInput = z.infer<typeof createReceivableSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type ReversalInput = z.infer<typeof reversalSchema>;
export type PaymentChangeInput = z.infer<typeof paymentChangeSchema>;
export type PaymentChangeDecisionInput = z.infer<typeof paymentChangeDecisionSchema>;
export type RenegotiationInput = z.infer<typeof renegotiationSchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type FinanceListQuery = z.infer<typeof financeListQuerySchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;
export type ExpenseHistoryQuery = z.infer<typeof expenseHistoryQuerySchema>;
export type ExpenseSummaryQuery = z.infer<typeof expenseSummaryQuerySchema>;
export type ExpensePaymentInput = z.infer<typeof expensePaymentSchema>;
