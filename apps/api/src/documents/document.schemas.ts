import { z } from 'zod';
import { DOCUMENT_TEMPLATE_CATEGORIES } from './document-templates';

export const generatedDocumentCategories = [
  'CONTRATO_HONORARIOS',
  'PROCURACAO',
  'HIPOSSUFICIENCIA',
] as const;

export const documentGenerationSchema = z
  .object({
    clientId: z.string().uuid(),
    category: z.enum(generatedDocumentCategories),
    contractId: z.string().uuid().optional(),
  })
  .superRefine((value, context) => {
    if (value.category === 'CONTRATO_HONORARIOS' && !value.contractId) {
      context.addIssue({
        code: 'custom',
        path: ['contractId'],
        message: 'Selecione o contrato de honorários.',
      });
    }
    if (value.category !== 'CONTRATO_HONORARIOS' && value.contractId) {
      context.addIssue({
        code: 'custom',
        path: ['contractId'],
        message: 'O contrato relacionado só se aplica ao contrato de honorários.',
      });
    }
  });

export const officeDocumentSettingsSchema = z.object({
  attorneyName: z.string().trim().min(3).max(200),
  professionalRegistration: z.string().trim().min(3).max(120),
  officeAddress: z.string().trim().min(8).max(500),
  jurisdiction: z.string().trim().min(3).max(160),
  paymentInstructions: z.string().trim().max(1000).optional(),
});

export const documentTemplateCategorySchema = z.enum(DOCUMENT_TEMPLATE_CATEGORIES);

export const documentTemplateUpdateSchema = z.object({
  category: documentTemplateCategorySchema,
  content: z.string().trim().min(100).max(40_000),
});

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
export type DocumentGenerationInput = z.infer<typeof documentGenerationSchema>;
export type OfficeDocumentSettingsInput = z.infer<typeof officeDocumentSettingsSchema>;
export type DocumentTemplateCategoryInput = z.infer<typeof documentTemplateCategorySchema>;
export type DocumentTemplateUpdateInput = z.infer<typeof documentTemplateUpdateSchema>;
