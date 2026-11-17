import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { runtime, snapshot } from './runtime.mjs';
import { invokeWriter } from './fixtures.mjs';
import { measuredRecovery, interruptionRecovery } from './concurrency-proof.mjs';
import { writerBoundary } from './writer-faults.mjs';
const require = createRequire(import.meta.url);
const expire = (r, org) =>
  r.db.storageUploadIntent.updateMany({
    where: { organizationId: org },
    data: { dueAt: new Date(0), leaseUntil: new Date(0) },
  });

async function pending(r, input) {
  await writerBoundary(r, input, 'F04', {});
  const op = await r.db.storageUploadIntent.findFirstOrThrow({
    where: { organizationId: input.actor.organizationId, state: 'RECONCILE_PENDING' },
  });
  await expire(r, input.actor.organizationId);
  return op;
}
async function exhausted(r, input, noAdministrator = false) {
  const op = await pending(r, input);
  if (noAdministrator)
    await r.db.organizationMember.updateMany({
      where: { organizationId: input.actor.organizationId },
      data: { status: 'SUSPENDED' },
    });
  const remove = r.storage.remove.bind(r.storage);
  r.storage.remove = async () => {
    throw Object.assign(new Error('INJECTED_PROVIDER_UNAVAILABLE'), { code: 'ECONNRESET' });
  };
  try {
    for (let i = op.attempts; i < 8; i++) {
      await expire(r, input.actor.organizationId);
      await r.recovery.recoverOne(op.id);
    }
  } finally {
    r.storage.remove = remove;
  }
  return r.db.storageRecoveryIncident.findFirstOrThrow({
    where: { organizationId: input.actor.organizationId, kind: 'RECOVERY_RETRIES_EXHAUSTED' },
  });
}
// ApiExceptionFilter emits the six ApiErrorBody fields. Nest's optional error
// label is accepted only when it agrees with the HTTP status. No domain data
// or unreviewed fields are permitted in a negative response.
export function assertRecoveryErrorResponse(body, status, requestPath) {
  const contracts = {
    400: ['bad_request', 'Bad Request'],
    401: ['unauthorized', 'Unauthorized'],
    403: ['forbidden', 'Forbidden'],
    404: ['not_found', 'Not Found'],
    409: ['conflict', 'Conflict'],
  };
  assert.ok(contracts[status], 'Unexpected recovery error status');
  assert.ok(body && typeof body === 'object' && !Array.isArray(body));
  const fields = ['statusCode', 'code', 'message', 'requestId', 'timestamp', 'path'];
  assert.ok(
    Object.keys(body).every((key) => fields.includes(key) || key === 'error'),
    'Recovery error response must not contain protected or unknown fields',
  );
  assert.ok(
    fields.every((key) => Object.hasOwn(body, key)),
    'Incomplete ApiErrorBody',
  );
  assert.equal(body.statusCode, status);
  assert.equal(body.code, contracts[status][0]);
  if (Object.hasOwn(body, 'error')) assert.equal(body.error, contracts[status][1]);
  assert.ok(
    typeof body.message === 'string' &&
      body.message.trim().length > 0 &&
      [...body.message].every((character) => {
        const point = character.codePointAt(0);
        return point >= 32 && point !== 127;
      }) &&
      !/eyJ[\w-]+\.[\w-]+\.[\w-]+|Bearer\s|https?:\/\/|postgres(?:ql)?:\/\//i.test(body.message),
    'Invalid or credential-bearing error message',
  );
  assert.ok(
    typeof body.requestId === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(body.requestId),
    'Invalid request correlation',
  );
  assert.ok(
    typeof body.timestamp === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.timestamp) &&
      Number.isFinite(Date.parse(body.timestamp)) &&
      new Date(body.timestamp).toISOString() === body.timestamp,
    'Invalid error timestamp',
  );
  assert.equal(body.path, requestPath, 'Error response belongs to another route');
}

export async function api(input, path, options = {}) {
  const requestUrl = new URL(process.env.NEXT_PUBLIC_API_URL + path);
  const response = await fetch(requestUrl, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + input.authToken,
      'X-Organization-Id': input.actor.organizationId,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (response.status >= 400)
    assertRecoveryErrorResponse(await response.json(), response.status, requestUrl.pathname);
  return { http: response.status }; // No token, cookies, raw response or signed URL in evidence.
}

export async function transversal(r, row, fixture, independentRecovery) {
  const input = await fixture(r, 'DOCUMENT'),
    org = input.actor.organizationId;
  row.before = await snapshot(r, org);
  switch (row.id) {
    case 'REC-X01': {
      const op = await pending(r, input),
        other = await runtime(),
        observer = await runtime();
      try {
        row.measurements = [{}, {}];
        const outcomes = await Promise.allSettled([
          measuredRecovery(r, observer, op.id, row.measurements[0]),
          measuredRecovery(other, observer, op.id, row.measurements[1]),
        ]);
        row.workers = outcomes.map((outcome) => {
          assert.equal(outcome.status, 'fulfilled');
          return outcome.value;
        });
        assert.ok(
          row.measurements.some((m) => m.externalIoSamples?.length),
          'Winning worker must produce real PostgreSQL transaction observations',
        );
        assert.equal((await r.storage.inspect(op.objectKey, op.bucket)).status, 'ABSENT');
        assert.equal(
          await r.db.storageRecoveryEvent.count({
            where: { operationId: op.id, toState: 'DELETING' },
          }),
          op.attempts + 1,
        );
      } finally {
        await other.db.$disconnect();
        await observer.db.$disconnect();
      }
      await interruptionRecovery(fixture, row);
      break;
    }
    case 'REC-X02': {
      const op = await pending(r, input);
      await r.recovery.recoverOne(op.id);
      const events = await r.db.storageRecoveryEvent.count({ where: { operationId: op.id } });
      await independentRecovery(input);
      assert.equal(
        await r.db.storageRecoveryEvent.count({ where: { operationId: op.id } }),
        events,
      );
      break;
    }
    case 'REC-X03':
    case 'REC-X04': {
      const incident = await exhausted(r, input, row.id === 'REC-X04');
      const op = await r.db.storageUploadIntent.findUniqueOrThrow({
        where: { id: incident.operationId },
      });
      assert.equal(op.attempts, 8);
      assert.equal(op.state, 'INCIDENT');
      assert.equal(incident.notificationUndelivered, row.id === 'REC-X04');
      if (row.id === 'REC-X03') assert.ok(incident.notificationId);
      break;
    }
    case 'REC-X05': {
      for (const purpose of ['VERSION', 'PHOTO', 'SIGNATURE']) {
        const f = await fixture(r, purpose);
        await invokeWriter(r, f);
        if (purpose === 'VERSION') {
          // No public document-delete API exists. This is a synthetic legacy
          // soft-delete fixture, not a product operation or proof of that API.
          await r.db.$transaction(async (tx) => {
            const document = await tx.document.findFirstOrThrow({
              where: { id: f.documentId, organizationId: f.actor.organizationId, deletedAt: null },
            });
            assert.equal(document.title, 'SYNTHETIC RECOVERY TEST');
            const deletedAt = new Date();
            await tx.document.update({ where: { id: document.id }, data: { deletedAt } });
            await r.audit.record(tx, {
              organizationId: f.actor.organizationId,
              actorUserId: f.actor.userId,
              action: 'UPDATE',
              resource: 'document',
              resourceId: document.id,
              before: { deletedAt: null },
              after: { deletedAt: deletedAt.toISOString() },
              metadata: { syntheticFixture: 'REC-X05_LEGACY_SOFT_DELETE' },
            });
          });
          const document = await r.db.document.findUniqueOrThrow({ where: { id: f.documentId } });
          assert.ok(document.deletedAt);
          assert.equal(
            await r.db.documentVersion.count({ where: { documentId: f.documentId } }),
            2,
          );
          row.softDeleteFixture = {
            documentId: document.id,
            deletedAt: document.deletedAt,
            auditCount: await r.db.auditLog.count({
              where: {
                resource: 'document',
                resourceId: document.id,
                organizationId: f.actor.organizationId,
                metadata: { path: ['syntheticFixture'], equals: 'REC-X05_LEGACY_SOFT_DELETE' },
              },
            }),
          };
          assert.equal(row.softDeleteFixture.auditCount, 1);
        }
        await r.db.storageUploadIntent.updateMany({
          where: { organizationId: f.actor.organizationId },
          data: { legalHold: true, dueAt: new Date(0), leaseUntil: new Date(0) },
        });
        const before = await snapshot(r, f.actor.organizationId);
        await independentRecovery(f);
        const after = await snapshot(r, f.actor.organizationId);
        assert.deepEqual(after.versions, before.versions);
        assert.deepEqual(after.photos, before.photos);
        assert.deepEqual(after.signatures, before.signatures);
        assert.deepEqual(after.objects, before.objects);
        assert.ok(after.intents.every((op) => op.legalHold && op.state === 'RETAINED'));
        for (const op of after.intents) {
          assert.ok(
            after.events.some(
              (event) => event.operationId === op.id && event.toState === 'RETAINED',
            ),
          );
          assert.ok(after.audit.some((entry) => entry.resourceId === op.id));
        }
        for (const object of after.objects) assert.equal(object.observation.status, 'PRESENT');
        row.retention ??= [];
        row.retention.push({ purpose, before, after });
      }
      break;
    }
    case 'REC-X06': {
      const id = randomUUID(),
        key = `organizations/${org}/documents/${id}/synthetic-mismatch.pdf`,
        bytes = Buffer.from('SYNTHETIC MISMATCH TEST');
      const ticket = await r.recovery.plan({
        organizationId: org,
        purpose: 'DOCUMENT',
        bucket: 'legal-documents',
        key,
        resourceType: 'document',
        resourceId: id,
        expectedSha256: 'a'.repeat(64),
        idempotencyKey: id,
      });
      await r.db.$transaction(async (tx) => {
        const op = await r.recovery.lock(tx, ticket.id);
        await r.recovery.transition(tx, op, 'UPLOADING');
      });
      await r.storage.upload(key, bytes, 'application/pdf');
      await expire(r, org);
      await r.recovery.recoverOne(ticket.id);
      const op = await r.db.storageUploadIntent.findUniqueOrThrow({ where: { id: ticket.id } });
      assert.equal(op.lastErrorCode, 'HASH_MISMATCH');
      assert.equal((await r.storage.inspect(key)).status, 'PRESENT');
      await assert.rejects(
        r.recovery.plan({
          organizationId: org,
          purpose: 'DOCUMENT',
          bucket: 'legal-documents',
          key: 'organizations/' + randomUUID() + '/test',
          resourceType: 'document',
          resourceId: id,
          expectedSha256: 'a'.repeat(64),
          idempotencyKey: randomUUID(),
        }),
      );
      break;
    }
    case 'REC-X07': {
      const key = `organizations/${org}/discovery/synthetic-unknown.pdf`,
        bytes = Buffer.from('SYNTHETIC UNKNOWN OBJECT');
      await r.storage.upload(key, bytes, 'application/pdf');
      const discovered = await r.admin.recordDiscovery(input.actor, {
        bucket: 'legal-documents',
        prefix: `organizations/${org}/discovery`,
        offset: 0,
      });
      assert.equal(discovered.results.find((o) => o.key === key).classification, 'UNKNOWN_OBJECT');
      assert.equal(
        (await r.storage.inspect(key)).sha256,
        createHash('sha256').update(bytes).digest('hex'),
      );
      // Deliberately broken synthetic legacy reference, never used to "repair" a real document.
      await r.db.document.create({
        data: {
          organizationId: org,
          title: 'SYNTHETIC MISSING REFERENCE',
          createdById: input.actor.userId,
          versions: {
            create: {
              organizationId: org,
              version: 1,
              storageKey: `organizations/${org}/missing/${randomUUID()}.pdf`,
              fileName: 'synthetic-missing.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1n,
              sha256: 'a'.repeat(64),
              uploadedById: input.actor.userId,
            },
          },
        },
      });
      const refs = await r.admin.inspectReferences(input.actor, 'VERSION');
      assert.ok(refs.results.some((v) => v.classification === 'REFERENCE_WITHOUT_OBJECT'));
      row.discovery = discovered;
      row.referenceScan = refs;
      break;
    }
    case 'REC-X08': {
      const original = r.recovery.complete.bind(r.recovery);
      let preview;
      r.recovery.complete = async (tx, ticket) => {
        const op = await tx.storageUploadIntent.findUniqueOrThrow({ where: { id: ticket.id } });
        // Inventory is read from another committed connection while the attachment waits.
        preview = await r.admin.preview(input.actor, {
          bucket: 'legal-documents',
          prefix: op.objectKey.slice(0, op.objectKey.lastIndexOf('/')),
          offset: 0,
        });
        return original(tx, ticket);
      };
      try {
        await invokeWriter(r, input);
      } finally {
        r.recovery.complete = original;
      }
      assert.ok(preview.results.some((o) => o.classification === 'UPLOAD_IN_PROGRESS'));
      row.discovery = preview;
      break;
    }
    case 'REC-X09':
    case 'REC-X11': {
      const incident = await exhausted(r, input),
        other = await runtime();
      try {
        const calls = await Promise.allSettled([
          r.admin.decide(
            input.actor,
            incident.id,
            'RETRY',
            'SYNTHETIC authorized recovery evaluation',
          ),
          other.admin.decide(
            input.actor,
            incident.id,
            'RETRY',
            'SYNTHETIC concurrent recovery evaluation',
          ),
        ]);
        assert.equal(calls.filter((c) => c.status === 'fulfilled').length, 1);
        assert.equal(calls.filter((c) => c.status === 'rejected').length, 1);
        const op = await r.db.storageUploadIntent.findUniqueOrThrow({
          where: { id: incident.operationId },
        });
        assert.equal(op.generation, 1);
        assert.equal(op.state, 'RECONCILE_PENDING');
        assert.equal(op.attempts, 0);
        assert.ok(
          await r.db.auditLog.count({
            where: { organizationId: org, resource: 'storage_recovery_incident' },
          }),
        );
        await assert.rejects(
          r.db.document.create({
            data: {
              id: op.resourceId,
              organizationId: org,
              title: 'SYNTHETIC FENCED ATTACHMENT',
              createdById: input.actor.userId,
              versions: {
                create: {
                  organizationId: org,
                  version: 1,
                  storageKey: op.objectKey,
                  fileName: 'synthetic.pdf',
                  mimeType: 'application/pdf',
                  sizeBytes: 1n,
                  sha256: op.expectedSha256,
                  uploadedById: input.actor.userId,
                },
              },
            },
          }),
        );
      } finally {
        await other.db.$disconnect();
      }
      break;
    }
    case 'REC-X10': {
      row.http = [await api(input, '/storage-recovery')];
      assert.equal(row.http[0].http, 200);
      const ownIncident = await exhausted(r, input),
        decisionPath = `/storage-recovery/incidents/${ownIncident.id}/decisions`;
      row.http.push(
        await api(input, decisionPath, {
          method: 'POST',
          body: JSON.stringify({ action: 'RETRY', reason: '' }),
        }),
      );
      assert.equal(row.http.at(-1).http, 400);
      row.http.push(
        await api(input, decisionPath, {
          method: 'POST',
          body: JSON.stringify({ action: 'RETRY', reason: 'SYNTHETIC authorized API retry' }),
        }),
      );
      assert.equal(row.http.at(-1).http, 201);
      row.http.push(
        await api(input, decisionPath, {
          method: 'POST',
          body: JSON.stringify({ action: 'RETRY', reason: 'SYNTHETIC repeated API retry' }),
        }),
      );
      assert.equal(row.http.at(-1).http, 409);
      const ownOperation = await r.db.storageUploadIntent.findUniqueOrThrow({
        where: { id: ownIncident.operationId },
      });
      assert.equal(ownOperation.generation, 1);
      assert.equal(ownOperation.state, 'RECONCILE_PENDING');
      assert.ok(
        await r.db.auditLog.count({
          where: {
            organizationId: org,
            resource: 'storage_recovery_incident',
            resourceId: ownIncident.id,
            actorUserId: input.actor.userId,
          },
        }),
      );
      const foreign = await fixture(r, 'DOCUMENT'),
        incident = await exhausted(r, foreign);
      const foreignDecisionBefore = await snapshot(r, org);
      const foreignOrganizationBefore = await snapshot(r, foreign.actor.organizationId);
      row.http.push(
        await api(input, `/storage-recovery/incidents/${incident.id}/decisions`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'RETAIN',
            reason: 'SYNTHETIC forbidden foreign decision',
          }),
        }),
      );
      assert.equal(row.http.at(-1).http, 404);
      assert.deepEqual(await snapshot(r, org), foreignDecisionBefore);
      assert.deepEqual(await snapshot(r, foreign.actor.organizationId), foreignOrganizationBefore);
      for (const actor of [
        { ...input.actor, permissions: [] },
        { ...input.actor, isAdministrator: false },
        { ...input.actor, clientId: input.clientId },
      ])
        await assert.rejects(r.admin.overview(actor));
      await r.db.organizationMember.update({
        where: { id: input.memberId },
        data: { status: 'SUSPENDED' },
      });
      const suspendedBefore = await snapshot(r, input.actor.organizationId);
      row.http.push(await api(input, '/storage-recovery'));
      assert.equal(row.http.at(-1).http, 401);
      row.http.push(
        await api(input, decisionPath, {
          method: 'POST',
          body: JSON.stringify({ action: 'RETRY', reason: 'SYNTHETIC suspended decision' }),
        }),
      );
      assert.equal(row.http.at(-1).http, 401);
      assert.deepEqual(await snapshot(r, input.actor.organizationId), suspendedBefore);
      await r.db.organizationMember.update({
        where: { id: input.memberId },
        data: { status: 'ACTIVE' },
      });
      const membership = await r.db.organizationMember.findUniqueOrThrow({
        where: { id: input.memberId },
        include: { roles: { include: { role: true } } },
      });
      assert.ok(membership.roles.some(({ role }) => role.key === 'administrator'));
      const permissionWhere = {
        organizationId: org,
        roleId: { in: membership.roles.map(({ role }) => role.id) },
        permission: { resource: 'storage_recovery' },
      };
      const recoveryPermissions = await r.db.rolePermission.findMany({ where: permissionWhere });
      assert.ok(recoveryPermissions.length);
      // Keep admission and the canonical administrator role. Remove only the
      // specific recovery permissions, never every membership role.
      await r.db.rolePermission.deleteMany({ where: permissionWhere });
      const unpermittedBefore = await snapshot(r, org);
      row.http.push(await api(input, '/storage-recovery'));
      assert.equal(row.http.at(-1).http, 403);
      row.http.push(
        await api(input, decisionPath, {
          method: 'POST',
          body: JSON.stringify({ action: 'RETRY', reason: 'SYNTHETIC forbidden decision' }),
        }),
      );
      assert.equal(row.http.at(-1).http, 403);
      await assert.rejects(
        r.admin.decide(input.actor, incident.id, 'RETAIN', 'SYNTHETIC forbidden foreign incident'),
      );
      assert.deepEqual(await snapshot(r, org), unpermittedBefore);
      await r.db.rolePermission.createMany({ data: recoveryPermissions });
      // With permissions restored, exercise an actual RETAIN decision as well
      // as the RETRY and concurrent-decision contracts in X09/X11.
      const retainInput = await fixture(r, 'DOCUMENT');
      const retained = await exhausted(r, retainInput);
      const retainPath = `/storage-recovery/incidents/${retained.id}/decisions`;
      row.http.push(
        await api(retainInput, retainPath, {
          method: 'POST',
          body: JSON.stringify({ action: 'RETAIN', reason: 'SYNTHETIC authorized retention' }),
        }),
      );
      assert.equal(row.http.at(-1).http, 201);
      const retainedOperation = await r.db.storageUploadIntent.findUniqueOrThrow({
        where: { id: retained.operationId },
      });
      assert.equal(retainedOperation.state, 'RETAINED');
      assert.equal(retainedOperation.legalHold, true);
      assert.equal(
        (await r.storage.inspect(retainedOperation.objectKey, retainedOperation.bucket)).sha256,
        retainedOperation.expectedSha256,
      );
      assert.ok(
        await r.db.auditLog.count({
          where: {
            organizationId: retainInput.actor.organizationId,
            resource: 'storage_recovery_incident',
            resourceId: retained.id,
            actorUserId: retainInput.actor.userId,
          },
        }),
      );
      const retainAfter = await snapshot(r, retainInput.actor.organizationId);
      row.http.push(
        await api(retainInput, retainPath, {
          method: 'POST',
          body: JSON.stringify({ action: 'RETAIN', reason: 'SYNTHETIC repeated retention' }),
        }),
      );
      assert.equal(row.http.at(-1).http, 409);
      assert.deepEqual(await snapshot(r, retainInput.actor.organizationId), retainAfter);
      row.retainedOperation = {
        id: retainedOperation.id,
        state: retainedOperation.state,
        legalHold: true,
      };
      break;
    }
    case 'REC-X12': {
      const op = await pending(r, input);
      await r.recovery.recoverOne(op.id);
      const events = await r.db.storageRecoveryEvent.findMany({ where: { operationId: op.id } });
      for (const state of ['PLANNED', 'UPLOADING', 'OBJECT_CREATED', 'DELETING', 'ABSENT'])
        assert.ok(events.some((e) => e.toState === state));
      await assert.rejects(r.db.storageRecoveryEvent.deleteMany({ where: { operationId: op.id } }));
      assert.ok(
        await r.db.auditLog.count({
          where: { organizationId: org, resource: 'storage_recovery', resourceId: op.id },
        }),
      );
      break;
    }
    case 'REC-X13': {
      const { ScheduledDispatchService } = require(
        resolve('apps/api/dist/notifications/scheduled-dispatch.service.js'),
      );
      const secret = 'synthetic-recovery-hmac-' + randomUUID(),
        config = { get: (key) => (key === 'CRON_SECRET' ? secret : r.config.get(key)) };
      const dispatch = new ScheduledDispatchService(r.db, config, {}, r.recovery),
        timestamp = String(Math.floor(Date.now() / 1000));
      await assert.rejects(dispatch.runRecovery(timestamp, '0'.repeat(64)));
      const signature = createHmac('sha256', secret)
        .update(timestamp + ':storage-recovery-dispatch')
        .digest('hex');
      await dispatch.runRecovery(timestamp, signature);
      assert.deepEqual(await dispatch.runRecovery(timestamp, signature), { duplicate: true });
      break;
    }
    case 'REC-X14': {
      await pending(r, input);
      const before = await snapshot(r, org);
      await r.recovery.recoverDue(true);
      const after = await snapshot(r, org);
      assert.deepEqual(after, before);
      break;
    }
    case 'REC-X15': {
      const { PDFDocument, StandardFonts } = require('pdf-lib'),
        pdf = await PDFDocument.create(),
        page = pdf.addPage([600, 180]);
      const marker = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
      page.drawText(marker, {
        x: 10,
        y: 100,
        size: 9,
        font: await pdf.embedFont(StandardFonts.Courier),
      });
      input.bytes = Buffer.from(await pdf.save()).toString('base64');
      await assert.rejects(invokeWriter(r, input));
      assert.equal(await r.db.document.count({ where: { organizationId: org } }), 0);
      const after = await snapshot(r, org);
      assert.ok(after.intents.length);
      assert.ok(after.objects.every((o) => o.observation.status === 'ABSENT'));
      break;
    }
    case 'REC-X16': {
      const path = resolve(process.env.LIVIO_QA_OUTPUT, 'workflow-stages/financial-stage3.json');
      if (!existsSync(path)) {
        row.reason =
          'Run the preserved financial harness in this same disposable rehearsal before linking REC-C01 evidence.';
        row.result = 'NOT_EXECUTED';
        return;
      }
      const financial = JSON.parse(readFileSync(path, 'utf8'));
      const cases = financial.cases.filter((c) => /DEF-007|DEF007|CEN-006/.test(c.id));
      assert.ok(cases.length);
      assert.ok(cases.every((c) => c.status === 'PASS'));
      row.financialEvidence = path;
      row.contractIds = cases.map((c) => c.id);
      break;
    }
    case 'REC-X17': {
      const f = await fixture(r, 'SIGNATURE');
      const group = randomUUID();
      await r.db.$transaction(async (tx) => {
        await tx.documentSigningRequest.update({
          where: { id: f.signingId },
          data: {
            status: 'PROCESSING',
            processingGroupId: group,
            processingLeaseUntil: new Date(0),
          },
        });
        for (const purpose of ['SIGNATURE', 'SIGNED_PDF'])
          await r.recovery.planInTransaction(tx, {
            organizationId: f.actor.organizationId,
            actorUserId: f.actor.userId,
            purpose,
            bucket: purpose === 'SIGNATURE' ? 'document-signatures' : 'legal-documents',
            key: `organizations/${f.actor.organizationId}/documents/${randomUUID()}/synthetic`,
            resourceType: purpose === 'SIGNATURE' ? 'document_signing_request' : 'document',
            resourceId: purpose === 'SIGNATURE' ? f.signingId : randomUUID(),
            expectedSha256: 'a'.repeat(64),
            groupId: group,
            idempotencyKey: purpose + group,
          });
      });
      await expire(r, f.actor.organizationId);
      const result = await independentRecovery(f);
      row.recoveredGroup = result;
      const request = await r.db.documentSigningRequest.findUniqueOrThrow({
        where: { id: f.signingId },
      });
      assert.equal(request.status, 'PENDING');
      assert.equal(request.processingGroupId, null);
      break;
    }
    case 'REC-X18':
      row.result = 'NOT_EXECUTED';
      row.reason =
        'Run the coordinated-restore phase in run-ci after the owned source API stops; standalone matrix cannot claim restore.';
      return;
    default:
      throw new Error('UNIMPLEMENTED_CONTRACT');
  }
  row.after = await snapshot(r, org);
  row.observedState = row.after.intents.map((o) => ({ id: o.id, state: o.state }));
  row.observedPhysicalEffect = row.after.objects;
  row.result = 'PASS';
  row.evidence =
    'Real disposable service/database/provider observations in before/after and contract-specific fields';
}
