import { z } from 'zod';

export const internalNoteSchema = z
  .object({
    clientId: z.string().uuid().optional(),
    matterId: z.string().uuid().optional(),
    body: z.string().trim().min(1).max(20_000),
  })
  .refine((value) => value.clientId || value.matterId, { message: 'Informe cliente ou processo' });

export const clientMessageSchema = z.object({
  clientId: z.string().uuid(),
  matterId: z.string().uuid().optional(),
  body: z.string().trim().min(1).max(20_000),
});

export const createTaskSchema = z.object({
  clientId: z.string().uuid().optional(),
  matterId: z.string().uuid().optional(),
  title: z.string().trim().min(2).max(240),
  description: z.string().max(10_000).optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED']).default('OPEN'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  assigneeId: z.string().uuid().optional(),
  dueAt: z.coerce.date().optional(),
});
export const updateTaskSchema = createTaskSchema.partial();
export const taskCommentSchema = z.object({ body: z.string().trim().min(1).max(10_000) });
export const taskReminderSchema = z.object({ remindAt: z.coerce.date() });

const calendarEventFields = z.object({
  clientId: z.string().uuid().optional(),
  matterId: z.string().uuid().optional(),
  title: z.string().trim().min(2).max(240),
  description: z.string().max(10_000).optional(),
  location: z.string().trim().max(500).optional(),
  type: z.enum(['HEARING', 'MEETING', 'LEGAL_DEADLINE', 'APPOINTMENT', 'OTHER']),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  timezone: z.string().min(3).max(80).default('America/Sao_Paulo'),
  allDay: z.boolean().default(false),
  attendees: z
    .array(z.object({ name: z.string().min(1).max(200), email: z.string().email().optional() }))
    .max(100)
    .default([]),
  recurrenceRule: z
    .string()
    .regex(/^FREQ=(DAILY|WEEKLY|MONTHLY)(;INTERVAL=\d{1,2})?(;COUNT=\d{1,3})?$/)
    .optional(),
});

export const calendarEventSchema = calendarEventFields.refine(
  (value) => value.endsAt > value.startsAt,
  {
    message: 'Fim deve ser posterior ao início',
    path: ['endsAt'],
  },
);

export const updateCalendarEventSchema = calendarEventFields
  .partial()
  .refine((value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, {
    message: 'Fim deve ser posterior ao início',
    path: ['endsAt'],
  });

export type InternalNoteInput = z.infer<typeof internalNoteSchema>;
export type ClientMessageInput = z.infer<typeof clientMessageSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskCommentInput = z.infer<typeof taskCommentSchema>;
export type TaskReminderInput = z.infer<typeof taskReminderSchema>;
export type CalendarEventInput = z.infer<typeof calendarEventSchema>;
export type UpdateCalendarEventInput = z.infer<typeof updateCalendarEventSchema>;
