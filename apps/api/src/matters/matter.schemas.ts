import { z } from 'zod';

export const createMatterSchema = z.object({
  clientId: z.string().uuid(),
  pipelineId: z.string().uuid().optional(),
  currentStageId: z.string().uuid().optional(),
  responsibleLawyerId: z.string().uuid().optional(),
  responsibleSecretaryId: z.string().uuid().optional(),
  reference: z.string().trim().min(1).max(80),
  title: z.string().trim().min(2).max(240),
  description: z.string().max(10_000).optional(),
  courtNumber: z.string().trim().max(80).optional(),
  area: z.string().trim().max(120).optional(),
  status: z.enum(['LEAD', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'ARCHIVED']).default('LEAD'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  nextAction: z.string().trim().max(500).optional(),
  nextActionAt: z.coerce.date().optional(),
  labels: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  lostReason: z.string().trim().max(500).optional(),
  confidential: z.boolean().default(false),
});

export const updateMatterSchema = createMatterSchema
  .omit({ clientId: true, reference: true, currentStageId: true })
  .partial();

export const moveMatterSchema = z.object({
  toStageId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

export const createMatterPartySchema = z.object({
  clientId: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(240),
  taxId: z.string().trim().max(24).optional(),
  partyRole: z.string().trim().min(2).max(120),
  side: z.string().trim().max(80).optional(),
});

export const createPipelineSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['COMMERCIAL', 'LEGAL', 'COLLECTION']),
  stages: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(120),
        position: z.number().int().min(0),
        color: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
        isTerminal: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(30),
});

export const createStageSchema = z.object({
  name: z.string().trim().min(2).max(120),
  position: z.number().int().min(0),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  isTerminal: z.boolean().default(false),
});

export const updateStageSchema = createStageSchema
  .partial()
  .extend({ isActive: z.boolean().optional() });

export type CreateMatterInput = z.infer<typeof createMatterSchema>;
export type UpdateMatterInput = z.infer<typeof updateMatterSchema>;
export type MoveMatterInput = z.infer<typeof moveMatterSchema>;
export type CreateMatterPartyInput = z.infer<typeof createMatterPartySchema>;
export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
export type CreateStageInput = z.infer<typeof createStageSchema>;
export type UpdateStageInput = z.infer<typeof updateStageSchema>;
