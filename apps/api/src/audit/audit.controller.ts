import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedActor } from '@livio/shared';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { pageResult, pageWindow } from '../common/schemas';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  resource: z.string().max(100).optional(),
  actorUserId: z.string().uuid().optional(),
});

@ApiTags('Auditoria')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  @RequirePermission('audit:view')
  async list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: z.infer<typeof auditQuerySchema>,
  ) {
    const where = {
      organizationId: actor.organizationId,
      ...(query.resource ? { resource: query.resource } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        ...pageWindow(query),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
}
