import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedActor } from '@livio/shared';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  calendarEventSchema,
  clientMessageSchema,
  createTaskSchema,
  internalNoteSchema,
  taskCommentSchema,
  taskReminderSchema,
  updateCalendarEventSchema,
  updateTaskSchema,
  type CalendarEventInput,
  type ClientMessageInput,
  type CreateTaskInput,
  type InternalNoteInput,
  type TaskCommentInput,
  type TaskReminderInput,
  type UpdateCalendarEventInput,
  type UpdateTaskInput,
} from './work.schemas';
import { WorkService } from './work.service';

const linkQuerySchema = z.object({
  clientId: z.string().uuid().optional(),
  matterId: z.string().uuid().optional(),
});
type LinkQuery = z.infer<typeof linkQuerySchema>;

@ApiTags('Trabalho jurídico')
@Controller()
export class WorkController {
  constructor(private readonly work: WorkService) {}

  @Post('internal-notes')
  @RequirePermission('notes:create')
  createNote(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(internalNoteSchema)) input: InternalNoteInput,
  ) {
    return this.work.createInternalNote(actor, input);
  }
  @Get('internal-notes')
  @RequirePermission('notes:view')
  notes(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(linkQuerySchema)) query: LinkQuery,
  ) {
    return this.work.listInternalNotes(actor, query.clientId, query.matterId);
  }

  @Post('client-messages')
  @RequirePermission('messages:create')
  createMessage(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(clientMessageSchema)) input: ClientMessageInput,
  ) {
    return this.work.createClientMessage(actor, input);
  }
  @Get('client-messages')
  @RequirePermission('messages:view')
  messages(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(linkQuerySchema)) query: LinkQuery,
  ) {
    return this.work.listClientMessages(actor, query.clientId, query.matterId);
  }

  @Post('tasks')
  @RequirePermission('tasks:create')
  createTask(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(createTaskSchema)) input: CreateTaskInput,
  ) {
    return this.work.createTask(actor, input);
  }
  @Get('tasks') @RequirePermission('tasks:view') listTasks(
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.work.listTasks(actor);
  }
  @Patch('tasks/:id')
  @RequirePermission('tasks:update')
  updateTask(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) input: UpdateTaskInput,
  ) {
    return this.work.updateTask(actor, id, input);
  }
  @Post('tasks/:id/comments')
  @RequirePermission('tasks:update')
  comment(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(taskCommentSchema)) input: TaskCommentInput,
  ) {
    return this.work.addTaskComment(actor, id, input);
  }
  @Post('tasks/:id/reminders')
  @RequirePermission('tasks:update')
  reminder(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(taskReminderSchema)) input: TaskReminderInput,
  ) {
    return this.work.addTaskReminder(actor, id, input);
  }

  @Post('calendar-events')
  @RequirePermission('calendar:create')
  createEvent(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(calendarEventSchema)) input: CalendarEventInput,
  ) {
    return this.work.createEvent(actor, input);
  }
  @Get('calendar-events') @RequirePermission('calendar:view') listEvents(
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.work.listEvents(actor);
  }
  @Patch('calendar-events/:id')
  @RequirePermission('calendar:update')
  updateEvent(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCalendarEventSchema)) input: UpdateCalendarEventInput,
  ) {
    return this.work.updateEvent(actor, id, input);
  }
}
