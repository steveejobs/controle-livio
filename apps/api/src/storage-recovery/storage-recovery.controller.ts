import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedActor } from '@livio/shared';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { RequireAdministrator } from '../auth/require-administrator.decorator';
import { Public } from '../auth/public.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ScheduledDispatchService } from '../notifications/scheduled-dispatch.service';
import { StorageRecoveryAdminService } from './storage-recovery-admin.service';
import { recoveryBuckets } from './storage-recovery.domain';

const discovery = z
  .object({
    bucket: z.enum(recoveryBuckets),
    prefix: z.string().max(1024).optional(),
    offset: z.number().int().min(0).max(100000).default(0),
  })
  .strict();
const decision = z
  .object({ action: z.enum(['RETRY', 'RETAIN']), reason: z.string().trim().min(12).max(1000) })
  .strict();
const references = z
  .object({
    kind: z.enum(['VERSION', 'PHOTO', 'SIGNATURE']),
    afterId: z.string().uuid().optional(),
  })
  .strict();

@Controller('storage-recovery')
export class StorageRecoveryController {
  constructor(
    private readonly admin: StorageRecoveryAdminService,
    private readonly dispatch: ScheduledDispatchService,
  ) {}

  @Get()
  @RequireAdministrator()
  @RequirePermission('storage_recovery:view')
  overview(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(z.object({ afterId: z.string().uuid().optional() }).strict()))
    query: { afterId?: string },
  ) {
    return this.admin.overview(actor, query.afterId);
  }

  @Post('preview')
  @RequireAdministrator()
  @RequirePermission('storage_recovery:view')
  preview(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(discovery)) input: z.infer<typeof discovery>,
  ) {
    return this.admin.preview(actor, input);
  }

  @Post('discover')
  @RequireAdministrator()
  @RequirePermission('storage_recovery:manage')
  discover(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(discovery)) input: z.infer<typeof discovery>,
  ) {
    return this.admin.recordDiscovery(actor, input);
  }

  @Post('inspect-references')
  @RequireAdministrator()
  @RequirePermission('storage_recovery:manage')
  inspectReferences(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(references)) input: z.infer<typeof references>,
  ) {
    return this.admin.inspectReferences(actor, input.kind, input.afterId);
  }

  @Post('incidents/:id/decisions')
  @RequireAdministrator()
  @RequirePermission('storage_recovery:manage')
  decide(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decision)) input: z.infer<typeof decision>,
  ) {
    return this.admin.decide(actor, id, input.action, input.reason);
  }

  @Get('dispatch/cron')
  @Public()
  run(
    @Headers('x-livio-scheduled-at') timestamp?: string,
    @Headers('x-livio-signature') signature?: string,
  ) {
    return this.dispatch.runRecovery(timestamp, signature);
  }
}
