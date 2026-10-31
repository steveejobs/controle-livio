import { z } from 'zod';

export const receiptUploadSchema = z
  .object({
    installmentId: z.string().uuid().optional(),
    expenseId: z.string().uuid().optional(),
  })
  .refine(
    (value) => Number(Boolean(value.installmentId)) + Number(Boolean(value.expenseId)) === 1,
    {
      message: 'Escolha exatamente uma parcela ou despesa.',
    },
  );

export const receiptConfirmationSchema = z.object({
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  paidAt: z.string().datetime({ offset: true }),
  method: z.string().trim().min(2).max(80),
  reference: z.string().trim().min(1).max(100),
  correctionReason: z.string().trim().min(5).max(500).optional(),
});

export const receiptDecisionSchema = z.object({
  reason: z.string().trim().min(5).max(500),
  decision: z.enum(['REJECTED', 'NEEDS_CORRECTION']),
});

export type ReceiptUploadInput = z.infer<typeof receiptUploadSchema>;
export type ReceiptConfirmationInput = z.infer<typeof receiptConfirmationSchema>;
export type ReceiptDecisionInput = z.infer<typeof receiptDecisionSchema>;
