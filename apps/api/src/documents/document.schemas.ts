import { z } from 'zod';

export const documentMetadataSchema = z.object({
  title: z.string().trim().min(2).max(240),
  category: z.string().trim().max(120).optional(),
  visibility: z.enum(['INTERNAL', 'CLIENT']).default('INTERNAL'),
  clientId: z.string().uuid().optional(),
  matterId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  installmentId: z.string().uuid().optional(),
  paymentId: z.string().uuid().optional(),
  expenseId: z.string().uuid().optional(),
});

export const documentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  clientId: z.string().uuid().optional(),
  matterId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  paymentId: z.string().uuid().optional(),
  expenseId: z.string().uuid().optional(),
});

export type DocumentMetadataInput = z.infer<typeof documentMetadataSchema>;
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;
