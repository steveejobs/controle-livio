import { Injectable } from '@nestjs/common';
import { Prisma } from '@livio/db';

interface AuditInput {
  organizationId: string;
  actorUserId?: string;
  actorSessionId?: string;
  action: Prisma.AuditLogCreateInput['action'];
  resource: string;
  resourceId?: string;
  requestId?: string;
  ipHash?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  record(transaction: Prisma.TransactionClient, input: AuditInput) {
    const metadata = json(input.metadata ?? {});
    const details =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? metadata
        : { details: metadata };
    return transaction.auditLog.create({
      data: {
        organizationId: input.organizationId,
        action: input.action,
        resource: input.resource,
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
        ...(input.resourceId ? { resourceId: input.resourceId } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.ipHash ? { ipHash: input.ipHash } : {}),
        ...(input.before !== undefined ? { before: json(input.before) } : {}),
        ...(input.after !== undefined ? { after: json(input.after) } : {}),
        // actor_session_id belongs to the retired sessions table and has a legacy tenant trigger.
        // Supabase session IDs remain traceable without recreating legacy authentication rows.
        metadata: {
          ...details,
          ...(input.actorSessionId ? { authSessionId: input.actorSessionId } : {}),
        },
      },
    });
  }
}
