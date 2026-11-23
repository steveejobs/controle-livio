import { z } from 'zod';

export const createDocumentSigningRequestSchema = z.object({
  signerName: z.string().trim().min(3).max(200).optional(),
  expiresInDays: z.coerce.number().int().min(1).max(30).default(7),
});

export const signDocumentSchema = z.object({
  signerName: z.string().trim().min(3).max(200),
  consent: z.literal(true),
  signature: z.string().min(100).max(700_000),
});

export type CreateDocumentSigningRequestInput = z.infer<typeof createDocumentSigningRequestSchema>;
export type SignDocumentInput = z.infer<typeof signDocumentSchema>;
