import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateIdentityEnvironment } from './identity-environment.mjs';

const hash = (b) => createHash('sha256').update(b).digest('hex');
export const storageOperations = [
  'upsert',
  'update',
  'delete',
  'move',
  'copy-new',
  'insert',
  'signed-upload',
  'copy-existing',
  'relink',
];
export function plannedStorageCells(actors, fixture) {
  assert.equal(actors.length, 8);
  assert.equal(new Set(actors.map(([role]) => role)).size, 8);
  return actors.flatMap(([role, identity]) =>
    storageOperations.map((operation) => ({
      id: `STORAGE52-${role}-${operation}`,
      role,
      operation,
      databaseRole: identity ? 'authenticated' : 'anon',
      profileId: identity?.profileId ?? null,
      organizationId: identity?.org ?? null,
      documentId: fixture.documentId,
      clientId: fixture.clientId,
      versionId: fixture.versionId,
      storageKey: fixture.storageKey,
      status: 'NOT_EXECUTED',
      reason: 'CONTROL_NOT_COMPLETE',
      requests: [],
    })),
  );
}
export function duplicateDestinationControl(response) {
  return (
    response.accepted === false &&
    ((response.http === 409 &&
      ['409', 'KeyAlreadyExists', 'Duplicate'].includes(String(response.code))) ||
      (response.http === 400 && response.code === 'KeyAlreadyExists'))
  );
}
export async function captureStorageControl(control, perform, cleanup) {
  try {
    await perform();
  } catch (error) {
    control.status = 'FAIL';
    control.error = { name: error.name, code: error.code ?? null };
  } finally {
    try {
      await cleanup();
      control.cleaned = true;
    } catch (error) {
      control.status = 'FAIL';
      control.cleaned = false;
      control.cleanupError = { name: error.name, code: error.code ?? null };
    }
  }
  return control;
}
export function storageDenial(http, body) {
  if (http >= 200 && http < 300) return 'ACCEPTED_OR_AMBIGUOUS_NOOP';
  const message = String(body?.message ?? body?.error ?? '');
  if (
    /row.level security|permission denied|not authorized|unauthori[sz]ed|access denied/i.test(
      message,
    ) &&
    !/invalid.*(jwt|token)|expired.*(jwt|token)/i.test(message)
  )
    return 'AUTHORIZATION_DENIED';
  return 'HARNESS_DOMAIN_OR_INFRA_FAILURE';
}

// Reuses the identity harness actors, real API fixtures, database and Storage client.
export async function runDocumentStorageMatrix({
  env,
  db,
  storage,
  actor,
  owner,
  foreign,
  client,
  document,
  png,
  request,
  upload,
}) {
  validateIdentityEnvironment(env, process.cwd());
  const out = resolve(env.LIVIO_QA_OUTPUT, 'workflow-stages/storage-stage52.json');
  const report = {
    scope: 'REAL_DISPOSABLE_STORAGE_NOT_MOCKED',
    cases: [],
    controls: [],
    setup: 'FAIL',
  };
  const save = () =>
    writeFileSync(
      out,
      JSON.stringify(
        report,
        (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
        2,
      ) + '\n',
    );
  const version = await db.documentVersion.findFirstOrThrow({ where: { documentId: document.id } });
  assert.equal(version.organizationId, owner.org);
  const linkedDocument = await db.document.findUniqueOrThrow({ where: { id: document.id } });
  assert.equal(linkedDocument.organizationId, owner.org);
  assert.equal(linkedDocument.clientId, client.id);
  assert.equal(linkedDocument.deletedAt, null);
  const bucket = 'legal-documents';
  const changed = Buffer.concat([png, Buffer.from('SYNTHETIC DIRECT CHANGE')]);
  const targetResponse = await request(owner, '/documents', {
    method: 'POST',
    body: upload(client.id),
  });
  assert.equal(targetResponse.http, 201);
  const copyVersion = await db.documentVersion.findFirstOrThrow({
    where: { documentId: targetResponse.body.id },
  });
  const second = await request(owner, '/clients', {
    method: 'POST',
    body: { type: 'PERSON', displayName: 'SYNTHETIC MATRIX RELINK TARGET' },
  });
  assert.equal(second.http, 201);
  async function stored(key) {
    const r = await storage.storage.from(bucket).download(key);
    if (r.error) {
      assert(
        ['400', '404'].includes(String(r.error.statusCode)) &&
          /not found|not exist|NoSuchKey/i.test(r.error.message),
      );
      return null;
    }
    return hash(Buffer.from(await r.data.arrayBuffer()));
  }
  async function snapshot(extra) {
    return {
      bytes: await stored(version.storageKey),
      destination: await stored(extra),
      document: await db.document.findUniqueOrThrow({ where: { id: document.id } }),
      copyDocument: await db.document.findUniqueOrThrow({ where: { id: targetResponse.body.id } }),
      versions: await db.documentVersion.findMany({
        where: { documentId: { in: [document.id, targetResponse.body.id] } },
        orderBy: { id: 'asc' },
      }),
      audit: await db.auditLog.findMany({
        where: { organizationId: owner.org },
        orderBy: { id: 'asc' },
      }),
      objects: await db.$queryRawUnsafe(
        "SELECT to_jsonb(o)-'last_accessed_at' AS object FROM storage.objects o WHERE bucket_id=$1 AND (name=$2 OR name=$3) ORDER BY name",
        bucket,
        version.storageKey,
        extra,
      ),
    };
  }
  async function attempt(token, operation, source, destination) {
    const base = env.NEXT_PUBLIC_SUPABASE_URL + '/storage/v1';
    const headers = {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + (token ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    };
    let url = base + '/object/' + bucket + '/' + source,
      method = 'POST',
      body = changed;
    headers['Content-Type'] = 'image/png';
    if (operation === 'upsert') headers['x-upsert'] = 'true';
    if (operation === 'update') method = 'PUT';
    if (operation === 'insert') url = base + '/object/' + bucket + '/' + destination;
    if (operation === 'delete') {
      method = 'DELETE';
      url = base + '/object/' + bucket;
      body = JSON.stringify({ prefixes: [source] });
      headers['Content-Type'] = 'application/json';
    }
    if (operation === 'move' || operation.startsWith('copy')) {
      url = base + '/object/' + (operation === 'move' ? 'move' : 'copy');
      body = JSON.stringify({ bucketId: bucket, sourceKey: source, destinationKey: destination });
      headers['Content-Type'] = 'application/json';
    }
    if (operation === 'signed-upload') {
      url = base + '/object/upload/sign/' + bucket + '/' + source;
      body = '{}';
      headers['Content-Type'] = 'application/json';
      headers['x-upsert'] = 'true';
    }
    if (operation === 'relink') {
      url = env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/documents?id=eq.' + document.id;
      method = 'PATCH';
      body = JSON.stringify({ client_id: second.body.id });
      headers['Content-Type'] = 'application/json';
    }
    const r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15000) });
    let payload;
    try {
      payload = await r.json();
    } catch {
      payload = {};
    }
    let signedUpload = null;
    if (operation === 'signed-upload' && r.ok) {
      const signedUrl = new URL(base + payload.url);
      assert.equal(signedUrl.origin, new URL(base).origin);
      const capability = signedUrl.searchParams.get('token');
      assert(capability, 'Signed upload control returned no capability');
      const uploadUrl = new URL(base + '/object/upload/sign/' + bucket + '/' + source);
      uploadUrl.searchParams.set('token', capability);
      const uploaded = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'image/png' },
        body: changed,
        signal: AbortSignal.timeout(15000),
      });
      signedUpload = { http: uploaded.status, accepted: uploaded.ok };
    }
    // Never persist a signed capability, response URL or token.
    return {
      http: r.status,
      method,
      path: new URL(url).pathname,
      code: payload.code ?? payload.statusCode ?? null,
      kind: storageDenial(r.status, payload),
      accepted: r.ok,
      signedUpload,
      authorizationMessage:
        /row.level security|permission denied|not authorized|unauthori[sz]ed|access denied/i.test(
          String(payload.message ?? payload.error ?? ''),
        ),
    };
  }
  const actors = [
    ['administrator', owner],
    ['lawyer', await actor(owner.org, 'lawyer')],
    ['secretary', await actor(owner.org, 'secretary')],
    ['finance', await actor(owner.org, 'finance')],
    ['client', await actor(owner.org, 'client', client.id)],
    ['anon', null],
    ['foreign', foreign],
    ['suspended', await actor(owner.org)],
  ];
  await db.organizationMember.update({
    where: { id: actors.at(-1)[1].memberId },
    data: { status: 'SUSPENDED' },
  });
  // Materialize all planned cells before controls; setup failure is never an empty PASS.
  report.cases = plannedStorageCells(actors, {
    documentId: document.id,
    clientId: client.id,
    versionId: version.id,
    storageKey: version.storageKey,
  });
  save();
  // Control every payload through the server role on explicit transient test objects.
  // These keys are recorded, removed and absence-checked; never touch unrelated objects.
  const supported = new Set();
  for (const operation of storageOperations) {
    if (operation === 'relink') {
      supported.add(operation);
      continue;
    }
    const root = `organizations/${owner.org}/qa-transient/${randomUUID()}`;
    const from = root + '/source.png',
      to = root + '/target.png';
    const control = {
      operation,
      purpose: 'TRANSIENT_TEST_CONTROL',
      organizationId: owner.org,
      keys: [from, to],
      status: 'FAIL',
    };
    report.controls.push(control);
    save();
    await captureStorageControl(
      control,
      async () => {
        assert.equal(
          (await storage.storage.from(bucket).upload(from, png, { contentType: 'image/png' }))
            .error,
          null,
        );
        assert.equal(await stored(from), hash(png));
        if (operation === 'copy-existing')
          assert.equal(
            (await storage.storage.from(bucket).upload(to, png, { contentType: 'image/png' }))
              .error,
            null,
          );
        control.before = { source: await stored(from), destination: await stored(to) };
        control.objectsBefore = await db.$queryRawUnsafe(
          "SELECT to_jsonb(o)-'last_accessed_at' AS object FROM storage.objects o WHERE bucket_id=$1 AND name IN ($2,$3) ORDER BY name",
          bucket,
          from,
          to,
        );
        control.response = await attempt(env.SUPABASE_SERVICE_ROLE_KEY, operation, from, to);
        control.after = { source: await stored(from), destination: await stored(to) };
        if (operation === 'copy-existing' && !control.response.accepted) {
          assert(
            duplicateDestinationControl(control.response),
            'Only a duplicate-destination contract is inapplicable',
          );
          assert.deepEqual(control.after, control.before);
          control.objectsAfter = await db.$queryRawUnsafe(
            "SELECT to_jsonb(o)-'last_accessed_at' AS object FROM storage.objects o WHERE bucket_id=$1 AND name IN ($2,$3) ORDER BY name",
            bucket,
            from,
            to,
          );
          assert.deepEqual(control.objectsAfter, control.objectsBefore);
          control.status = 'UNSUPPORTED_EXISTING_DESTINATION';
        } else {
          assert(control.response.accepted, 'Structurally valid server control rejected');
          if (['upsert', 'update'].includes(operation))
            assert.equal(await stored(from), hash(changed));
          if (operation === 'signed-upload') {
            assert(control.response.signedUpload.accepted);
            assert.equal(await stored(from), hash(changed));
          }
          if (['move', 'delete'].includes(operation)) assert.equal(await stored(from), null);
          if (['move', 'copy-new', 'copy-existing'].includes(operation))
            assert.equal(await stored(to), hash(png));
          if (operation === 'insert') assert.equal(await stored(to), hash(changed));
          supported.add(operation);
          control.status = 'PASS';
        }
      },
      async () => {
        const removed = await storage.storage.from(bucket).remove([from, to]);
        assert.equal(removed.error, null);
        assert.equal(await stored(from), null);
        assert.equal(await stored(to), null);
      },
    );
    if (control.status === 'FAIL') supported.delete(operation);
    save();
  }
  assert.equal(await stored(version.storageKey), version.sha256);
  assert.equal(
    JSON.parse(
      Buffer.from(env.NEXT_PUBLIC_SUPABASE_ANON_KEY.split('.')[1], 'base64url').toString('utf8'),
    ).role,
    'anon',
  );
  for (const [role, identity] of actors) {
    try {
      if (identity) {
        const claims = JSON.parse(
          Buffer.from(identity.token.split('.')[1], 'base64url').toString('utf8'),
        );
        assert.equal(claims.role, 'authenticated');
        assert.equal(claims.sub, identity.profileId);
        const valid = await storage.auth.getUser(identity.token);
        assert.equal(valid.error, null);
        assert.equal(valid.data.user.id, identity.profileId);
        const membership = await db.organizationMember.findUniqueOrThrow({
          where: { id: identity.memberId },
          include: { roles: { include: { role: true } } },
        });
        assert.equal(membership.organizationId, identity.org);
        if (role === 'client') assert.equal(membership.clientId, client.id);
        assert.equal(membership.status, role === 'suspended' ? 'SUSPENDED' : 'ACTIVE');
        const expectedRole = ['foreign', 'suspended'].includes(role) ? 'administrator' : role;
        assert(membership.roles.some(({ role }) => role.key === expectedRole));
      }
    } catch (error) {
      report.profileErrors ??= [];
      report.profileErrors.push({ role, name: error.name, code: error.code ?? null });
      for (const c of report.cases.filter((c) => c.role === role))
        c.reason = 'INVALID_TEST_IDENTITY';
      save();
      continue;
    }
    for (const operation of storageOperations) {
      const c = report.cases.find((c) => c.role === role && c.operation === operation);
      if (!supported.has(operation)) {
        c.status = 'NOT_EXECUTED';
        c.reason =
          report.controls.find((r) => r.operation === operation)?.status ===
          'UNSUPPORTED_EXISTING_DESTINATION'
            ? 'SERVER_CONTROL_DOES_NOT_SUPPORT_EXISTING_DESTINATION'
            : 'SERVER_CONTROL_FAILED';
        save();
        continue;
      }
      const destination =
        operation === 'copy-existing'
          ? copyVersion.storageKey
          : `organizations/${owner.org}/qa-forbidden/${randomUUID()}.png`;
      try {
        c.status = 'FAIL';
        delete c.reason;
        c.before = await snapshot(destination);
        assert.equal(c.before.bytes, version.sha256);
        assert.equal(
          c.before.destination,
          operation === 'copy-existing' ? copyVersion.sha256 : null,
        );
        c.fixtureValid = true;
        c.jwtValidated = Boolean(identity);
        try {
          c.attempt = await attempt(identity?.token, operation, version.storageKey, destination);
        } finally {
          c.after = await snapshot(destination);
        }
        assert.equal(c.attempt.kind, 'AUTHORIZATION_DENIED');
        assert.deepEqual(c.after, c.before);
        c.status = 'PASS';
      } catch (error) {
        c.error = { name: error.name, code: error.code ?? null };
      }
      save();
    }
  }
  report.setup =
    report.controls.some((c) => c.status === 'FAIL') || report.profileErrors?.length
      ? 'FAIL'
      : 'PASS';
  report.summary = {
    planned: report.cases.length,
    sent: report.cases.filter((c) => c.attempt).length,
    passed: report.cases.filter((c) => c.status === 'PASS').length,
    failed: report.cases.filter((c) => c.status === 'FAIL').length,
    notExecuted: report.cases.filter((c) => c.status === 'NOT_EXECUTED').length,
  };
  save();
  assert(
    report.setup === 'PASS' &&
      report.cases.length === 72 &&
      report.cases.every(
        (c) =>
          c.status === 'PASS' ||
          (c.status === 'NOT_EXECUTED' &&
            c.reason === 'SERVER_CONTROL_DOES_NOT_SUPPORT_EXISTING_DESTINATION'),
      ),
    'Document Storage authorization matrix failed',
  );
  return report;
}
