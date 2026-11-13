import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type StorageUploadIntent } from '@livio/db';
import type { ApiEnvironment } from '@livio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { StorageService } from '../documents/storage.service';
import {
  absenceRecheckMs,
  assertRecoveryTransition,
  maxRecoveryAttempts,
  objectBelongsToOrganization,
  recoveryDecision,
  recoveryDelayMs,
  recoveryErrorCode,
  recoveryLeaseMs,
  sha256,
  type RecoveryBucket,
  type RecoveryPurpose,
  type RecoveryState,
} from './storage-recovery.domain';

type Tx = Prisma.TransactionClient;
export interface UploadTicket {
  id: string;
  organizationId: string;
  ownerToken: string;
}
export interface UploadPlan {
  organizationId: string;
  actorUserId?: string;
  purpose: RecoveryPurpose;
  bucket: RecoveryBucket;
  key: string;
  resourceType: 'document' | 'client' | 'document_signing_request';
  resourceId: string;
  expectedSha256: string | null;
  idempotencyKey: string;
  groupId?: string;
}
type Reference = { organization_id: string; kind: string };
type RecoveryResult = { status: string; code?: string; error?: unknown };

@Injectable()
export class StorageRecoveryService {
  private readonly logger = new Logger(StorageRecoveryService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<ApiEnvironment, true>,
  ) {}

  private ticket(row: StorageUploadIntent): UploadTicket {
    return { id: row.id, organizationId: row.organizationId, ownerToken: row.ownerToken };
  }

  async plan(input: UploadPlan): Promise<UploadTicket> {
    return this.prisma.$transaction((tx) => this.planInTransaction(tx, input));
  }

  async planInTransaction(tx: Tx, input: UploadPlan): Promise<UploadTicket> {
    if (
      !objectBelongsToOrganization(input.organizationId, input.bucket, input.key) ||
      !input.idempotencyKey ||
      input.idempotencyKey.length > 160 ||
      (input.expectedSha256 === null && input.purpose !== 'SIGNED_PDF') ||
      (input.expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(input.expectedSha256))
    )
      throw new ConflictException('Identidade de arquivo inválida');
    const id = randomUUID(),
      owner = randomUUID(),
      lease = new Date(Date.now() + recoveryLeaseMs);
    const preexisting = await tx.$queryRaw<Array<{ present: boolean }>>`SELECT EXISTS(
      SELECT 1 FROM storage.objects WHERE bucket_id=${input.bucket} AND name=${input.key}) AS present`;
    const prior = await tx.storageUploadIntent.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (preexisting[0]?.present && !prior)
      throw new ConflictException('Objeto anterior não pode ser adotado por uma nova intenção');
    await tx.$executeRaw`INSERT INTO storage_upload_intents
      (id,organization_id,purpose,bucket,object_key,resource_type,resource_id,group_id,expected_sha256,
       idempotency_key,owner_token,lease_until,due_at,actor_user_id)
      VALUES (${id}::uuid,${input.organizationId}::uuid,${input.purpose},${input.bucket},${input.key},
        ${input.resourceType},${input.resourceId}::uuid,${input.groupId ?? null}::uuid,${input.expectedSha256},
        ${input.idempotencyKey},${owner}::uuid,${lease},${lease},${input.actorUserId ?? null}::uuid)
      ON CONFLICT (organization_id,idempotency_key) DO NOTHING`;
    const row = await tx.storageUploadIntent.findUniqueOrThrow({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (
      row.bucket !== input.bucket ||
      row.objectKey !== input.key ||
      row.purpose !== input.purpose ||
      row.resourceType !== input.resourceType ||
      row.resourceId !== input.resourceId ||
      row.groupId !== (input.groupId ?? null) ||
      (input.expectedSha256 !== null && row.expectedSha256 !== input.expectedSha256)
    )
      throw new ConflictException('A chave idempotente pertence a outra operação');
    return this.ticket(row);
  }

  async lock(tx: Tx, id: string, skip = false): Promise<StorageUploadIntent | null> {
    const rows = skip
      ? await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM storage_upload_intents WHERE id=${id}::uuid FOR UPDATE SKIP LOCKED`
      : await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM storage_upload_intents WHERE id=${id}::uuid FOR UPDATE`;
    return rows.length ? tx.storageUploadIntent.findUniqueOrThrow({ where: { id } }) : null;
  }

  private owns(
    row: StorageUploadIntent | null,
    ticket: UploadTicket,
  ): asserts row is StorageUploadIntent {
    if (
      !row ||
      row.organizationId !== ticket.organizationId ||
      row.ownerToken !== ticket.ownerToken
    )
      throw new ConflictException('Operação de arquivo pertence a outro processamento');
  }

  async transition(
    tx: Tx,
    row: StorageUploadIntent,
    state: RecoveryState,
    patch: Prisma.StorageUploadIntentUncheckedUpdateInput = {},
  ) {
    assertRecoveryTransition(row.state, state);
    return tx.storageUploadIntent.update({ where: { id: row.id }, data: { ...patch, state } });
  }

  async store(ticket: UploadTicket, bytes: Buffer, mime: string, inspect: () => Promise<void>) {
    const digest = sha256(bytes);
    let row = await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, ticket.id);
      this.owns(current, ticket);
      if (current.expectedSha256 === null && current.state === 'PLANNED') {
        return tx.storageUploadIntent.update({
          where: { id: current.id },
          data: { expectedSha256: digest },
        });
      }
      if (current.expectedSha256 !== digest)
        throw new ConflictException('Conteúdo diferente da intenção de upload');
      return current;
    });
    if (
      !['PLANNED', 'UPLOADING', 'OBJECT_CREATED'].includes(row.state) ||
      row.cleanupStartedAt ||
      row.abandonedAt ||
      row.leaseUntil <= new Date()
    )
      throw new ConflictException('Intenção de upload vencida ou já concluída');
    await inspect(); // Intent exists durably, but no Storage write precedes ClamAV.
    if (row.state === 'PLANNED')
      row = await this.prisma.$transaction(async (tx) => {
        const current = await this.lock(tx, ticket.id);
        this.owns(current, ticket);
        if (current.state !== 'PLANNED')
          throw new ConflictException('Upload já está em processamento');
        return this.transition(tx, current, 'UPLOADING');
      });
    let observed = await this.storage.inspect(row.objectKey, row.bucket);
    if (observed.status === 'UNKNOWN')
      throw new ServiceUnavailableException('Não foi possível verificar o arquivo privado');
    if (observed.status === 'ABSENT') {
      try {
        await this.storage.upload(row.objectKey, bytes, mime, row.bucket);
      } catch (error) {
        observed = await this.storage.inspect(row.objectKey, row.bucket);
        if (observed.status !== 'PRESENT' || observed.sha256 !== digest) throw error;
      }
      observed = await this.storage.inspect(row.objectKey, row.bucket);
    }
    if (
      observed.status !== 'PRESENT' ||
      observed.sha256 !== digest ||
      observed.size !== bytes.length
    )
      throw new ServiceUnavailableException('Integridade do arquivo enviado não comprovada');
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, ticket.id);
      this.owns(current, ticket);
      if (
        current.cleanupStartedAt ||
        current.abandonedAt ||
        current.leaseUntil <= new Date() ||
        !['UPLOADING', 'OBJECT_CREATED'].includes(current.state)
      )
        throw new ConflictException('O processamento do upload venceu');
      await this.transition(tx, current, 'OBJECT_CREATED', { observedSha256: digest });
    });
  }

  async lockForAttachment(tx: Tx, ticket: UploadTicket) {
    const row = await this.lock(tx, ticket.id);
    this.owns(row, ticket);
    if (
      row.state !== 'OBJECT_CREATED' ||
      row.abandonedAt ||
      row.cleanupStartedAt ||
      row.leaseUntil <= new Date() ||
      !row.expectedSha256 ||
      row.observedSha256 !== row.expectedSha256
    )
      throw new ConflictException('O arquivo não pode mais ser vinculado');
    return row;
  }

  async complete(tx: Tx, ticket: UploadTicket) {
    const row = await this.lockForAttachment(tx, ticket);
    const refs = await this.references(tx, row);
    if (!refs.length || refs.some((r) => r.organization_id !== row.organizationId))
      throw new ConflictException('Vínculo do arquivo não comprovado');
    const attached = await this.transition(tx, row, 'ATTACHED', { attachedAt: new Date() });
    await this.transition(tx, attached, 'COMPLETE', {
      completedAt: new Date(),
      dueAt: new Date(Date.now() + absenceRecheckMs),
    });
  }

  references(tx: Tx, row: StorageUploadIntent): Promise<Reference[]> {
    // Includes all organizations, historical versions, soft deletes and revoked signatures.
    return tx.$queryRaw<
      Reference[]
    >`SELECT organization_id,'VERSION' AS kind FROM document_versions WHERE storage_key=${row.objectKey}
      UNION ALL SELECT organization_id,'PHOTO' FROM clients WHERE photo_storage_key=${row.objectKey}
      UNION ALL SELECT organization_id,'SIGNATURE' FROM document_signing_requests WHERE signature_storage_key=${row.objectKey}`;
  }

  private async metadataPresent(tx: Tx, row: StorageUploadIntent) {
    const [result] = await tx.$queryRaw<Array<{ present: boolean }>>`SELECT EXISTS(
      SELECT 1 FROM storage.objects WHERE bucket_id=${row.bucket} AND name=${row.objectKey}) AS present`;
    return result?.present !== false;
  }

  async retire(
    tx: Tx,
    organizationId: string,
    bucket: RecoveryBucket,
    key: string,
  ): Promise<UploadTicket | null> {
    const found = await tx.storageUploadIntent.findUnique({
      where: { bucket_objectKey: { bucket, objectKey: key } },
    });
    if (!found) {
      await this.incident(
        tx,
        { organizationId, bucket, objectKey: key },
        'LEGACY_RETIREMENT_REQUIRES_REVIEW',
      );
      return null;
    }
    const row = await this.lock(tx, found.id);
    if (!row || row.organizationId !== organizationId)
      throw new ConflictException('Arquivo de outra organização');
    if (row.legalHold) return null;
    if (!['COMPLETE', 'RETAINED'].includes(row.state))
      throw new ConflictException('Arquivo em processamento incompatível');
    const ownerToken = randomUUID();
    const retired = await this.transition(tx, row, 'RECONCILE_PENDING', {
      cleanupStartedAt: new Date(),
      dueAt: new Date(),
      leaseUntil: new Date(0),
      ownerToken,
      lastErrorCode: 'AUTHORIZED_PHOTO_RETIREMENT',
    });
    return this.ticket(retired);
  }

  private async abandon(tx: Tx, row: StorageUploadIntent, code: string) {
    // A timed-out HTTP request may still be in flight. Fence ATTACHMENT now;
    // admit the original upload only until its original lease expires.
    if (row.state === 'UPLOADING' && !row.observedSha256 && row.leaseUntil > new Date())
      return this.transition(tx, row, 'UPLOADING', {
        abandonedAt: row.abandonedAt ?? new Date(),
        lastErrorCode: code,
        dueAt: row.leaseUntil,
      });
    if (['PLANNED', 'UPLOADING', 'OBJECT_CREATED'].includes(row.state))
      return this.transition(tx, row, 'COMPENSATION_REQUIRED', {
        abandonedAt: row.abandonedAt ?? new Date(),
        lastErrorCode: code,
        cleanupStartedAt: row.cleanupStartedAt ?? new Date(),
        dueAt: new Date(),
        leaseUntil: new Date(0),
      });
    return row;
  }

  async compensate(ticket: UploadTicket, primary?: unknown) {
    let pending;
    try {
      pending = await this.prisma.$transaction(async (tx) => {
        const row = await this.lock(tx, ticket.id);
        this.owns(row, ticket);
        return this.abandon(tx, row, recoveryErrorCode(primary));
      });
    } catch (error) {
      this.logger.error({
        event: 'storage_recovery_enqueue_failed',
        operationId: ticket.id,
        code: recoveryErrorCode(error),
      });
      throw new ServiceUnavailableException('Compensacao persistente indisponivel', {
        cause: primary ?? error,
      });
    }
    try {
      if (pending.state === 'UPLOADING' && pending.abandonedAt && pending.leaseUntil > new Date())
        throw new ServiceUnavailableException('Upload incerto aguarda conclusao do provedor', {
          cause: primary,
        });
      const result = await this.recoverOne(ticket.id, ticket);
      if (result.error) throw result.error;
    } catch (error) {
      this.logger.error({
        event: 'storage_recovery_compensation_pending',
        operationId: ticket.id,
        code: recoveryErrorCode(error),
      });
      throw new ServiceUnavailableException('Compensacao pendente de recuperacao persistente', {
        cause: primary ?? error,
      });
    }
  }

  async incident(
    tx: Tx,
    target: { organizationId: string; bucket: string; objectKey: string; id?: string },
    kind: string,
  ) {
    const fingerprint = sha256(Buffer.from(`${target.bucket}\n${target.objectKey}\n${kind}`));
    let record = await tx.storageRecoveryIncident.upsert({
      where: { organizationId_fingerprint: { organizationId: target.organizationId, fingerprint } },
      create: {
        organizationId: target.organizationId,
        operationId: target.id,
        fingerprint,
        bucket: target.bucket,
        objectKey: target.objectKey,
        kind,
      },
      update: { lastObservedAt: new Date() },
    });
    if (record.state === 'RESOLVED' && kind === 'RECOVERY_RETRIES_EXHAUSTED') {
      // A newly exhausted manual retry is a NEW actionable occurrence. Prior
      // decisions and reasons remain in audit_logs; never leave it silently closed.
      record = await tx.storageRecoveryIncident.update({
        where: { id: record.id },
        data: {
          state: 'OPEN',
          resolution: null,
          resolutionReason: null,
          resolvedById: null,
          resolvedAt: null,
          notificationId: null,
          notificationUndelivered: false,
        },
      });
      await this.audit.record(tx, {
        organizationId: target.organizationId,
        action: 'UPDATE',
        resource: 'storage_recovery_incident',
        resourceId: record.id,
        before: { state: 'RESOLVED' },
        after: { state: 'OPEN', reason: 'MANUAL_RETRY_EXHAUSTED' },
      });
    }
    if (record.state !== 'OPEN' || record.notificationId) return record;
    const recipient = await tx.organizationMember.findFirst({
      where: {
        organizationId: target.organizationId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE', organizationId: target.organizationId },
        roles: {
          some: {
            role: { key: 'administrator', isSystem: true, organizationId: target.organizationId },
          },
        },
      },
      orderBy: { id: 'asc' },
      select: { userId: true },
    });
    if (!recipient)
      return tx.storageRecoveryIncident.update({
        where: { id: record.id },
        data: { notificationUndelivered: true },
      });
    const notification = await tx.notification.create({
      data: {
        organizationId: target.organizationId,
        userId: recipient.userId,
        channel: 'IN_APP',
        status: 'SENT',
        sentAt: new Date(),
        title: 'Arquivo exige revisão administrativa',
        body: 'Consulte Recuperação de arquivos para verificar o incidente.',
        metadata: { storageRecoveryIncidentId: record.id },
      },
    });
    record = await tx.storageRecoveryIncident.update({
      where: { id: record.id },
      data: { notificationId: notification.id, notificationUndelivered: false },
    });
    return record;
  }

  private async markIncident(tx: Tx, row: StorageUploadIntent, code: string) {
    if (row.state !== 'INCIDENT')
      await this.transition(tx, row, 'INCIDENT', { lastErrorCode: code, leaseUntil: new Date(0) });
    await this.incident(tx, { ...row, id: row.id }, code);
    return { status: 'INCIDENT', code };
  }

  private async retry(
    tx: Tx,
    row: StorageUploadIntent,
    error: unknown,
    counted = false,
  ): Promise<RecoveryResult> {
    const attempts = Math.min(maxRecoveryAttempts, row.attempts + (counted ? 0 : 1));
    const code = recoveryErrorCode(error);
    if (attempts >= maxRecoveryAttempts) {
      const updated = await tx.storageUploadIntent.update({
        where: { id: row.id },
        data: { attempts, lastErrorCode: code },
      });
      await this.markIncident(tx, updated, 'RECOVERY_RETRIES_EXHAUSTED');
      return { status: 'INCIDENT', code, error };
    }
    let pending = row;
    if (['PLANNED', 'UPLOADING', 'OBJECT_CREATED'].includes(row.state))
      pending = await this.transition(tx, row, 'COMPENSATION_REQUIRED');
    if (pending.state === 'ABSENT')
      pending = await this.transition(tx, pending, 'RECONCILE_PENDING');
    const state = ['COMPLETE', 'RETAINED'].includes(pending.state)
      ? (pending.state as RecoveryState)
      : 'RECONCILE_PENDING';
    await this.transition(tx, pending, state, {
      attempts,
      lastErrorCode: code,
      dueAt: new Date(Date.now() + recoveryDelayMs(attempts)),
      leaseUntil: new Date(0),
    });
    return { status: state, code, error };
  }

  async assertFences(tx: Tx) {
    const [r] = await tx.$queryRaw<
      Array<{ count: number }>
    >`SELECT count(*)::int AS count FROM pg_trigger
      WHERE NOT tgisinternal AND tgenabled='O' AND (tgrelid,tgname::text,tgfoid) IN (
        ('public.document_versions'::regclass,'recovery_document_reference','public.storage_recovery_reference_fence()'::regprocedure),
        ('public.clients'::regclass,'recovery_photo_reference','public.storage_recovery_reference_fence()'::regprocedure),
        ('public.document_signing_requests'::regclass,'recovery_signature_reference','public.storage_recovery_reference_fence()'::regprocedure),
        ('storage.objects'::regclass,'recovery_managed_storage','public.storage_recovery_object_fence()'::regprocedure))`;
    if (r?.count !== 4) throw new ServiceUnavailableException('Fences de recuperação incompletos');
  }

  async recoverOne(id: string, ticket?: UploadTicket): Promise<RecoveryResult> {
    if (!ticket && !this.config.get('STORAGE_RECOVERY_DELETE_ENABLED', { infer: true }))
      return { status: 'DISABLED' };
    // Claim is committed BEFORE provider I/O. Rotating the capability fences
    // abandoned writers; no database connection is held during an HTTP call.
    const claim = await this.prisma.$transaction(
      async (tx) => {
        const row = await this.lock(tx, id, true);
        if (!row || row.state === 'INCIDENT') return null;
        if (ticket) this.owns(row, ticket);
        else if (row.dueAt > new Date() || row.leaseUntil > new Date()) return null;
        if (row.state === 'UPLOADING' && row.abandonedAt && row.leaseUntil > new Date())
          return null;
        if (!objectBelongsToOrganization(row.organizationId, row.bucket, row.objectKey))
          return this.markIncident(tx, row, 'OBJECT_IDENTITY_MISMATCH');
        await this.assertFences(tx);
        const owned = await tx.storageUploadIntent.update({
          where: { id },
          data: { ownerToken: randomUUID(), leaseUntil: new Date(Date.now() + 120_000) },
        });
        return { row: owned, ticket: this.ticket(owned) };
      },
      { maxWait: 5000, timeout: 10_000 },
    );
    if (!claim) return { status: 'SKIPPED' };
    if (!('ticket' in claim)) return claim;
    const observation = await this.storage.inspect(claim.row.objectKey, claim.row.bucket);
    const claimed = await this.prisma.$transaction(
      async (tx) => {
        let row = await this.lock(tx, id);
        if (!row || row.ownerToken !== claim.ticket.ownerToken || row.leaseUntil <= new Date())
          return null;
        await this.assertFences(tx);
        const refs = await this.references(tx, row);
        const decision = recoveryDecision({
          references: refs.length,
          foreignReference: refs.some((r) => r.organization_id !== row!.organizationId),
          legalHold: row.legalHold,
          expectedSha256: row.expectedSha256,
          observation,
          metadataPresent: await this.metadataPresent(tx, row),
        });
        if (decision === 'INCIDENT')
          return this.markIncident(
            tx,
            row,
            refs.some((r) => r.organization_id !== row!.organizationId)
              ? 'FOREIGN_REFERENCE'
              : observation.status === 'ABSENT'
                ? 'REFERENCE_WITHOUT_OBJECT'
                : 'HASH_MISMATCH',
          );
        if (decision === 'RETRY')
          return this.retry(tx, row, {
            code: observation.status === 'UNKNOWN' ? observation.code : 'PROVIDER_UNAVAILABLE',
          });
        if (decision === 'RETAIN') {
          // Retained rows are observed again; no reference/retention is relaxed.
          if (
            ['PLANNED', 'UPLOADING', 'OBJECT_CREATED', 'ATTACHED', 'DELETING'].includes(row.state)
          )
            return this.markIncident(tx, row, 'UNEXPECTED_REFERENCE');
          await this.transition(tx, row, 'RETAINED', {
            dueAt: new Date(Date.now() + absenceRecheckMs),
            lastCheckedAt: new Date(),
          });
          return { status: 'RETAINED' };
        }
        if (row.attachedAt && !row.cleanupStartedAt)
          return this.markIncident(tx, row, 'ATTACHED_REFERENCE_LOST');
        if (['PLANNED', 'UPLOADING', 'OBJECT_CREATED'].includes(row.state))
          row = await this.transition(tx, row, 'COMPENSATION_REQUIRED', {
            cleanupStartedAt: new Date(),
          });
        if (decision === 'ABSENT') {
          // A timed-out/in-flight upload that was NEVER physically observed is
          // not proven absent just because the provider has not indexed it yet.
          // Keep it actionable; bounded retries escalate instead of forgetting it.
          if (
            !row.observedSha256 &&
            (await tx.storageRecoveryEvent.count({
              where: { operationId: row.id, toState: 'UPLOADING' },
            }))
          )
            return this.retry(tx, row, { code: 'PROVIDER_UPLOAD_UNCONFIRMED' });
          if (row.state === 'COMPLETE' || row.state === 'RETAINED')
            return this.markIncident(tx, row, 'REFERENCE_OR_HASH_INTEGRITY');
          await this.transition(tx, row, 'ABSENT', {
            dueAt: new Date(Date.now() + absenceRecheckMs),
            lastCheckedAt: new Date(),
            leaseUntil: new Date(0),
          });
          return { status: 'ABSENT' };
        }
        if (row.attempts >= maxRecoveryAttempts)
          return this.markIncident(tx, row, 'RECOVERY_RETRIES_EXHAUSTED');
        if (row.state === 'ABSENT')
          row = await this.transition(tx, row, 'RECONCILE_PENDING', {
            lastErrorCode: 'LATE_OBJECT_OBSERVED',
          });
        const deleting = await this.transition(tx, row, 'DELETING', {
          observedSha256:
            observation.status === 'PRESENT' ? observation.sha256 : row.observedSha256,
          cleanupStartedAt: row.cleanupStartedAt ?? new Date(),
          attempts: row.attempts + 1,
          leaseUntil: new Date(Date.now() + 120_000),
          lastCheckedAt: new Date(),
        });

        return { ticket: this.ticket(deleting), row: deleting };
      },
      { maxWait: 5000, timeout: 10_000 },
    );
    if (!claimed) return { status: 'SKIPPED' };
    if (!('ticket' in claimed)) return claimed;
    // The permanent cleanup fence prohibits new references and key reuse.
    // Retention cannot be introduced once deletion is committed. Expired/stale
    // workers cannot finalize SQL; a new process verifies the physical effect.
    const ready = await this.prisma.$transaction(
      async (tx) => {
        const row = await this.lock(tx, id);
        if (
          !row ||
          row.ownerToken !== claimed.ticket.ownerToken ||
          row.state !== 'DELETING' ||
          row.leaseUntil <= new Date()
        )
          return false;
        await this.assertFences(tx);
        if (row.legalHold || (await this.references(tx, row)).length) return false;
        return true;
      },
      { maxWait: 5000, timeout: 10_000 },
    );
    if (!ready) return { status: 'SKIPPED' };
    let failure: unknown;
    let absent = false;
    let integrity = false;
    try {
      const before = await this.storage.inspect(claimed.row.objectKey, claimed.row.bucket);
      integrity = before.status === 'PRESENT' && before.sha256 !== claimed.row.expectedSha256;
      if (!integrity) {
        if (before.status === 'UNKNOWN')
          throw Object.assign(new Error('PROVIDER_UNAVAILABLE'), { code: before.code });
        if (before.status === 'PRESENT')
          await this.storage.remove(claimed.row.objectKey, claimed.row.bucket);
        const after = await this.storage.inspect(claimed.row.objectKey, claimed.row.bucket);
        absent = after.status === 'ABSENT';
        if (!absent) throw new ServiceUnavailableException('Physical removal is unconfirmed');
      }
    } catch (error) {
      failure = error;
    }
    return this.prisma.$transaction(
      async (tx) => {
        const row = await this.lock(tx, id);
        if (
          !row ||
          row.ownerToken !== claimed.ticket.ownerToken ||
          row.state !== 'DELETING' ||
          row.leaseUntil <= new Date()
        )
          return { status: 'SKIPPED' };
        await this.assertFences(tx);
        if (row.legalHold || (await this.references(tx, row)).length)
          return this.markIncident(tx, row, 'REMOVAL_FENCE_INTEGRITY');
        if (integrity) return this.markIncident(tx, row, 'REFERENCE_OR_HASH_INTEGRITY');
        if (failure || !absent || (await this.metadataPresent(tx, row)))
          return this.retry(
            tx,
            row,
            failure ?? new ServiceUnavailableException('Physical removal is unconfirmed'),
            true,
          );
        await this.transition(tx, row, 'ABSENT', {
          lastErrorCode: null,
          lastCheckedAt: new Date(),
          dueAt: new Date(Date.now() + absenceRecheckMs),
          leaseUntil: new Date(0),
        });
        return { status: 'ABSENT' };
      },
      { maxWait: 5000, timeout: 10_000 },
    );
  }

  async recoverDue(dryRun = false) {
    if (!dryRun && !this.config.get('STORAGE_RECOVERY_DISPATCH_ENABLED', { infer: true }))
      return { mode: 'DISABLED', results: [] };
    const rows = await this.prisma.storageUploadIntent.findMany({
      where: {
        dueAt: { lte: new Date() },
        state: { not: 'INCIDENT' },
        leaseUntil: { lte: new Date() },
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    if (dryRun) {
      const results = [];
      for (const row of rows)
        results.push({
          id: row.id,
          state: row.state,
          observation: await this.storage.inspect(row.objectKey, row.bucket),
        });
      return { mode: 'DRY_RUN', results }; // No UPDATE/event/incident or external write.
    }
    await this.expireSigningRequests();
    const results = [];
    for (const row of rows) {
      try {
        const result = await this.recoverOne(row.id);
        results.push({ id: row.id, status: result.status, code: result.code });
      } catch (error) {
        this.logger.error({
          event: 'storage_recovery_run_failed',
          operationId: row.id,
          code: recoveryErrorCode(error),
        });
        results.push({ id: row.id, status: 'FAILED' });
      }
    }
    if (results.some((r) => r.status === 'FAILED'))
      throw new ServiceUnavailableException('Uma ou mais operações de recuperação falharam');
    return { mode: 'RECONCILE', results };
  }

  async expireSigningRequests() {
    const rows = await this.prisma.documentSigningRequest.findMany({
      where: {
        status: 'PROCESSING',
        OR: [{ processingLeaseUntil: { lte: new Date() } }, { processingLeaseUntil: null }],
      },
      select: { id: true },
      take: 20,
      orderBy: { updatedAt: 'asc' },
    });
    for (const row of rows) await this.releaseSigningGroup(row.id);
  }

  async releaseSigningGroup(requestId: string, groupId?: string): Promise<UploadTicket[]> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM document_signing_requests WHERE id=${requestId}::uuid FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return [];
      const request = await tx.documentSigningRequest.findUniqueOrThrow({
        where: { id: requestId },
      });
      if (
        request.status !== 'PROCESSING' ||
        (groupId && request.processingGroupId !== groupId) ||
        (!groupId && request.processingLeaseUntil && request.processingLeaseUntil > new Date())
      )
        return [];
      const operations = request.processingGroupId
        ? await tx.storageUploadIntent.findMany({
            where: { organizationId: request.organizationId, groupId: request.processingGroupId },
            orderBy: { id: 'asc' },
          })
        : [];
      if (
        operations.length !== 2 ||
        !operations.some((o) => o.purpose === 'SIGNATURE') ||
        !operations.some((o) => o.purpose === 'SIGNED_PDF') ||
        operations.some(
          (o) =>
            (o.purpose === 'SIGNATURE' && o.resourceId !== request.id) ||
            ['ATTACHED', 'COMPLETE', 'RETAINED', 'INCIDENT'].includes(o.state),
        )
      ) {
        await this.incident(
          tx,
          {
            organizationId: request.organizationId,
            bucket: 'document-signatures',
            objectKey: `organizations/${request.organizationId}/signatures/${request.id}/`,
          },
          'SIGNING_GROUP_REQUIRES_REVIEW',
        );
        return [];
      }
      const tickets: UploadTicket[] = [];
      for (const operation of operations) {
        const row = await this.lock(tx, operation.id);
        if (!row) throw new ConflictException('Grupo de assinatura incompleto');
        const pending = await this.abandon(tx, row, 'SIGNING_PROCESS_ABANDONED');
        tickets.push(this.ticket(pending));
      }
      await tx.documentSigningRequest.update({
        where: { id: request.id },
        data: { status: 'PENDING', processingGroupId: null, processingLeaseUntil: null },
      });
      await this.audit.record(tx, {
        organizationId: request.organizationId,
        action: 'UPDATE',
        resource: 'document_signing_request',
        resourceId: request.id,
        before: { status: 'PROCESSING' },
        after: { status: 'PENDING', reason: 'PROCESSING_LEASE_RELEASED' },
      });
      return tickets;
    });
  }
}
