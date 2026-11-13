import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment, AuthenticatedActor } from '@livio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { StorageService } from '../documents/storage.service';
import { StorageRecoveryService } from './storage-recovery.service';
import {
  objectBelongsToOrganization,
  type RecoveryState,
  type RecoveryBucket,
} from './storage-recovery.domain';

export function assertRecoveryAdministrator(actor: AuthenticatedActor, manage = false) {
  if (
    !actor.organizationId ||
    !actor.userId ||
    actor.clientId ||
    !actor.isAdministrator ||
    !actor.permissions.includes(manage ? 'storage_recovery:manage' : 'storage_recovery:view')
  )
    throw new ForbiddenException('Recuperação de arquivos exige Administrador autorizado');
}

@Injectable()
export class StorageRecoveryAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recovery: StorageRecoveryService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<ApiEnvironment, true>,
  ) {}

  async overview(actor: AuthenticatedActor, afterId?: string) {
    assertRecoveryAdministrator(actor);
    const organizationId = actor.organizationId;
    if (
      afterId &&
      !(await this.prisma.storageRecoveryIncident.findFirst({
        where: { id: afterId, organizationId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Página de incidentes não encontrada');
    const [incidents, pending, overdue, undelivered] = await this.prisma.$transaction([
      this.prisma.storageRecoveryIncident.findMany({
        where: { organizationId, state: 'OPEN' },
        orderBy: [{ firstObservedAt: 'asc' }, { id: 'asc' }],
        ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
        take: 50,
        select: {
          id: true,
          kind: true,
          bucket: true,
          objectKey: true,
          operationId: true,
          state: true,
          notificationUndelivered: true,
          firstObservedAt: true,
          lastObservedAt: true,
        },
      }),
      this.prisma.storageUploadIntent.count({
        where: {
          organizationId,
          OR: [
            { state: { in: ['COMPENSATION_REQUIRED', 'RECONCILE_PENDING', 'DELETING'] } },
            { state: 'UPLOADING', abandonedAt: { not: null } },
          ],
        },
      }),
      this.prisma.storageUploadIntent.count({
        where: {
          organizationId,
          dueAt: { lte: new Date() },
          state: { notIn: ['INCIDENT', 'RETAINED', 'ABSENT', 'COMPLETE'] },
        },
      }),
      this.prisma.storageRecoveryIncident.count({
        where: { organizationId, state: 'OPEN', notificationUndelivered: true },
      }),
    ]);
    return {
      incidents,
      pending,
      overdue,
      undelivered,
      pageLimit: 50,
      nextCursor: incidents.length === 50 ? incidents.at(-1)!.id : null,
      workerEnabled: this.config.get('STORAGE_RECOVERY_DISPATCH_ENABLED', { infer: true }),
      deletionEnabled: this.config.get('STORAGE_RECOVERY_DELETE_ENABLED', { infer: true }),
    };
  }

  async decide(actor: AuthenticatedActor, id: string, action: 'RETRY' | 'RETAIN', reason: string) {
    assertRecoveryAdministrator(actor, true);
    const explanation = reason.trim();
    if (
      explanation.length < 12 ||
      explanation.length > 1000 ||
      /eyJ[\w-]+\.[\w-]+\.[\w-]+|Bearer\s|https?:\/\/|postgres(?:ql)?:\/\//i.test(explanation)
    )
      throw new ConflictException('Informe um motivo sem credenciais, links ou documentos');
    const initial = await this.prisma.storageRecoveryIncident.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!initial) throw new NotFoundException('Incidente não encontrado');
    const observedOperation =
      action === 'RETRY' && initial.operationId
        ? await this.prisma.storageUploadIntent.findFirst({
            where: { id: initial.operationId, organizationId: actor.organizationId },
          })
        : null;
    const observation = observedOperation
      ? await this.storage.inspect(observedOperation.objectKey, observedOperation.bucket)
      : null;
    return this.prisma.$transaction(
      async (tx) => {
        // Global order: operation, then incident. Workers use the same order.
        const op = initial.operationId ? await this.recovery.lock(tx, initial.operationId) : null;
        await tx.$queryRaw`SELECT id FROM storage_recovery_incidents WHERE id=${id}::uuid AND organization_id=${actor.organizationId}::uuid FOR UPDATE`;
        const current = await tx.storageRecoveryIncident.findFirst({
          where: { id, organizationId: actor.organizationId },
        });
        if (!current) throw new NotFoundException('Incidente não encontrado');
        if (current.state !== 'OPEN')
          throw new ConflictException('Incidente já foi tratado em outra sessão');
        if (op && op.organizationId !== actor.organizationId)
          throw new NotFoundException('Operação não encontrada');
        await tx.$queryRaw`SELECT set_config('livio.recovery_actor',${actor.userId},true)`;
        const critical = [
          'REFERENCE_WITHOUT_OBJECT',
          'HASH_MISMATCH',
          'FOREIGN_REFERENCE',
          'REFERENCE_OR_HASH_INTEGRITY',
          'SIGNING_GROUP_REQUIRES_REVIEW',
        ].includes(current.kind);
        if (action === 'RETRY') {
          if (
            !op ||
            current.kind !== 'RECOVERY_RETRIES_EXHAUSTED' ||
            op.state !== 'INCIDENT' ||
            op.legalHold ||
            (op.attachedAt && !op.cleanupStartedAt) ||
            !objectBelongsToOrganization(op.organizationId, op.bucket, op.objectKey)
          )
            throw new ConflictException(
              'Este incidente exige conservação ou restauração específica',
            );
          if (
            !observedOperation ||
            observedOperation.ownerToken !== op.ownerToken ||
            observedOperation.generation !== op.generation ||
            observedOperation.state !== op.state ||
            !observation
          )
            throw new ConflictException('Recovery changed during provider observation');
          const refs = await this.recovery.references(tx, op),
            observed = observation;
          if (
            refs.length ||
            observed.status === 'UNKNOWN' ||
            (observed.status === 'PRESENT' && observed.sha256 !== op.expectedSha256)
          )
            throw new ConflictException('Vínculo, retenção ou integridade impedem reprocessamento');
          await this.recovery.transition(tx, op, 'RECONCILE_PENDING', {
            attempts: 0,
            generation: op.generation + 1,
            lastErrorCode: 'MANUAL_RETRY_AUTHORIZED',
            dueAt: new Date(),
            leaseUntil: new Date(0),
          });
        } else if (op) {
          if (!['INCIDENT', 'RETAINED', 'COMPLETE'].includes(op.state))
            throw new ConflictException('Aguarde a operação em andamento');
          await this.recovery.transition(
            tx,
            op,
            op.state === 'INCIDENT' ? 'RETAINED' : (op.state as RecoveryState),
            { legalHold: true },
          );
        }
        // Retaining a damaged/missing file is NOT restoration and cannot close it.
        const state = action === 'RETAIN' && critical ? 'OPEN' : 'RESOLVED';
        const updated = await tx.storageRecoveryIncident.update({
          where: { id },
          data: {
            state,
            resolution: action,
            resolutionReason: explanation,
            resolvedById: actor.userId,
            resolvedAt: state === 'RESOLVED' ? new Date() : null,
          },
          select: { id: true, state: true, resolution: true },
        });
        await this.audit.record(tx, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          actorSessionId: actor.sessionId,
          action: 'UPDATE',
          resource: 'storage_recovery_incident',
          resourceId: id,
          before: { state: current.state },
          after: { state, decision: action, requiresRestoration: critical },
          metadata: { reason: explanation },
        });
        return updated;
      },
      { maxWait: 5000, timeout: 10000 },
    );
  }

  async preview(
    actor: AuthenticatedActor,
    input: { bucket: RecoveryBucket; prefix?: string; offset: number },
  ) {
    assertRecoveryAdministrator(actor);
    const root =
      input.bucket === 'client-photos'
        ? `${actor.organizationId}/clients`
        : `organizations/${actor.organizationId}`;
    const prefix = input.prefix?.replace(/\/$/, '') ?? root;
    if (
      (prefix !== root && !prefix.startsWith(root + '/')) ||
      prefix.includes('..') ||
      prefix.includes('\\')
    )
      throw new ForbiddenException('Inventário limitado à organização autenticada');
    const page = await this.storage.inventory(input.bucket, prefix, input.offset);
    const results = [];
    for (const entry of page) {
      const key = prefix + '/' + entry.name;
      if (entry.folder) {
        results.push({ key, classification: 'DIRECTORY' });
        continue;
      }
      const op = await this.prisma.storageUploadIntent.findUnique({
        where: { bucket_objectKey: { bucket: input.bucket, objectKey: key } },
      });
      if (op && op.organizationId !== actor.organizationId) {
        results.push({ key, classification: 'FOREIGN_OPERATION' });
        continue;
      }
      const refs = await this.prisma.$queryRaw<
        Array<{ organization_id: string }>
      >`SELECT organization_id FROM document_versions WHERE storage_key=${key}
        UNION ALL SELECT organization_id FROM clients WHERE photo_storage_key=${key}
        UNION ALL SELECT organization_id FROM document_signing_requests WHERE signature_storage_key=${key}`;
      const observed = await this.storage.inspect(key, input.bucket);
      const classification = refs.some((r) => r.organization_id !== actor.organizationId)
        ? 'FOREIGN_REFERENCE'
        : observed.status === 'UNKNOWN'
          ? 'INCONCLUSIVE'
          : observed.status === 'ABSENT'
            ? 'REFERENCE_WITHOUT_OBJECT'
            : op?.expectedSha256 && observed.sha256 !== op.expectedSha256
              ? 'HASH_MISMATCH'
              : refs.length
                ? 'LINKED_OR_HISTORICALLY_RETAINED'
                : op?.legalHold
                  ? 'LEGITIMATELY_RETAINED'
                  : op?.state === 'ABSENT'
                    ? 'LATE_OBJECT'
                    : op &&
                        ['PLANNED', 'UPLOADING', 'OBJECT_CREATED'].includes(op.state) &&
                        op.leaseUntil > new Date()
                      ? 'UPLOAD_IN_PROGRESS'
                      : op
                        ? 'AWAITING_COMPENSATION'
                        : 'UNKNOWN_OBJECT';
      results.push({
        key,
        classification,
        sha256: observed.status === 'PRESENT' ? observed.sha256 : null,
      });
    }
    // Pure preview: no intent, incident, audit or Storage writes.
    return {
      mode: 'READ_ONLY',
      bucket: input.bucket,
      prefix,
      offset: input.offset,
      nextOffset: page.length === 100 ? input.offset + 100 : null,
      results,
    };
  }

  async recordDiscovery(
    actor: AuthenticatedActor,
    input: { bucket: RecoveryBucket; prefix?: string; offset: number },
  ) {
    assertRecoveryAdministrator(actor, true);
    const result = await this.preview(actor, input);
    for (const row of result.results) {
      if (
        ![
          'UNKNOWN_OBJECT',
          'HASH_MISMATCH',
          'FOREIGN_REFERENCE',
          'FOREIGN_OPERATION',
          'REFERENCE_WITHOUT_OBJECT',
          'LATE_OBJECT',
        ].includes(row.classification)
      )
        continue;
      await this.prisma.$transaction(async (tx) => {
        await this.recovery.incident(
          tx,
          { organizationId: actor.organizationId, bucket: input.bucket, objectKey: row.key },
          row.classification,
        );
      });
    }
    return { ...result, mode: 'READ_ONLY_STORAGE_WITH_PERSISTED_INCIDENTS' };
  }

  async inspectReferences(
    actor: AuthenticatedActor,
    kind: 'VERSION' | 'PHOTO' | 'SIGNATURE',
    afterId?: string,
  ) {
    assertRecoveryAdministrator(actor, true);
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; object_key: string; sha256: string | null }>
    >`
      SELECT id,storage_key AS object_key,sha256::text FROM public.document_versions
      WHERE ${kind}='VERSION' AND organization_id=${actor.organizationId}::uuid AND (${afterId ?? null}::uuid IS NULL OR id>${afterId ?? null}::uuid)
      UNION ALL SELECT id,photo_storage_key,NULL FROM public.clients
      WHERE ${kind}='PHOTO' AND organization_id=${actor.organizationId}::uuid AND photo_storage_key IS NOT NULL AND (${afterId ?? null}::uuid IS NULL OR id>${afterId ?? null}::uuid)
      UNION ALL SELECT id,signature_storage_key,signature_sha256::text FROM public.document_signing_requests
      WHERE ${kind}='SIGNATURE' AND organization_id=${actor.organizationId}::uuid AND signature_storage_key IS NOT NULL AND (${afterId ?? null}::uuid IS NULL OR id>${afterId ?? null}::uuid)
      ORDER BY id LIMIT 50`;
    const bucket =
      kind === 'VERSION'
        ? 'legal-documents'
        : kind === 'PHOTO'
          ? 'client-photos'
          : 'document-signatures';
    const results = [];
    for (const row of rows) {
      const observed = await this.storage.inspect(row.object_key, bucket);
      const classification = !objectBelongsToOrganization(
        actor.organizationId,
        bucket,
        row.object_key,
      )
        ? 'FOREIGN_REFERENCE'
        : observed.status === 'UNKNOWN'
          ? 'INCONCLUSIVE'
          : observed.status === 'ABSENT'
            ? 'REFERENCE_WITHOUT_OBJECT'
            : row.sha256 && observed.sha256 !== row.sha256
              ? 'HASH_MISMATCH'
              : 'LINKED';
      if (
        ['REFERENCE_WITHOUT_OBJECT', 'HASH_MISMATCH', 'FOREIGN_REFERENCE'].includes(classification)
      )
        await this.prisma.$transaction((tx) =>
          this.recovery.incident(
            tx,
            { organizationId: actor.organizationId, bucket, objectKey: row.object_key },
            classification,
          ),
        );
      results.push({
        id: row.id,
        classification,
        sha256: observed.status === 'PRESENT' ? observed.sha256 : null,
      });
    }
    return {
      mode: 'READ_ONLY_STORAGE',
      kind,
      results,
      nextId: rows.length === 50 ? rows.at(-1)!.id : null,
    };
  }
}
