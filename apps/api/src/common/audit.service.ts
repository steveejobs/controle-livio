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
    return transaction.auditLog.create({
      data: {
        organizationId: input.organizationId,
        action: input.action,
        resource: input.resource,
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
        ...(input.actorSessionId ? { actorSessionId: input.actorSessionId } : {}),
        ...(input.resourceId ? { resourceId: input.resourceId } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.ipHash ? { ipHash: input.ipHash } : {}),
        ...(input.before !== undefined ? { before: json(input.before) } : {}),
        ...(input.after !== undefined ? { after: json(input.after) } : {}),
        metadata: json(input.metadata ?? {}),
      },
    });
  }
}
