import { z } from 'zod';

export const createClientSchema = z.object({
  type: z.enum(['PERSON', 'COMPANY']),
  displayName: z.string().trim().min(2).max(200),
  legalName: z.string().trim().max(240).optional(),
  taxId: z.string().trim().max(24).optional(),
  email: z.string().email().max(320).optional(),
  phone: z.string().trim().max(40).optional(),
  source: z.string().trim().max(120).optional(),
  address: z.record(z.string(), z.unknown()).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const updateClientSchema = createClientSchema.partial();

export const createContactSchema = z.object({
  name: z.string().trim().min(2).max(200),
  role: z.string().trim().max(120).optional(),
  email: z.string().email().max(320).optional(),
  phone: z.string().trim().max(40).optional(),
  isPrimary: z.boolean().default(false),
});

export const updateContactSchema = createContactSchema.partial();

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
