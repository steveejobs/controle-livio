import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateIdentityEnvironment } from './identity-environment.mjs';
import { runDocumentStorageMatrix } from './document-storage-matrix.mjs';

// Direct Node integration: API/SQL/Auth/Storage/scanner, never mocked persistence.
// No dotenv, no workflow changes, no financial test invocation.
export async function runIdentityIntegrity(env = process.env) {
  const root = process.cwd();
  validateIdentityEnvironment(env, root);
  const output = resolve(env.LIVIO_QA_OUTPUT, 'workflow-stages/identity-stage5.json');
  if (existsSync(output)) throw new Error('Existing identity evidence refused');
  const require = createRequire(import.meta.url);
  const { PrismaClient } = require('@prisma/client');
  const { createClient } = require('@supabase/supabase-js');
  const { createCanvas } = require('@napi-rs/canvas');
  const { PDFDocument } = require('pdf-lib');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const storage = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const evidence = {
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    scope: 'disposable API/Auth/PostgreSQL/Storage/ClamAV; no browser persistence claim',
    cases: [],
  };
  mkdirSync(dirname(output), { recursive: true });
  const save = () => writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  let active;
  const check = async (id, fn) => {
    active = { id, status: 'FAIL', requests: [] };
    evidence.cases.push(active);
    try {
      await fn();
      active.status = 'PASS';
    } catch (error) {
      active.error = { name: error.name, code: error.code ?? null };
    }
    save();
  };
  const request = async (actor, path, { method = 'GET', body } = {}) => {
    const r = await fetch(env.NEXT_PUBLIC_API_URL + path, {
      method,
      signal: AbortSignal.timeout(35000),
      headers: {
        Authorization: 'Bearer ' + actor.token,
        'X-Organization-Id': actor.org,
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    });
    const text = await r.text();
    const json = text && r.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
    active?.requests.push({ method, path, http: r.status, code: json?.code ?? null });
    return { http: r.status, body: json };
  };
  const expectStatus = (r, code) => {
    assert.equal(r.http, code);
    return r.body;
  };
  async function organization() {
    const org = await db.organization.create({
      data: {
        legalName: 'Synthetic identity QA',
        slug: 'identity-' + randomUUID(),
        status: 'ACTIVE',
      },
    });
    const source = await db.role.findMany({
      where: { organizationId: '10000000-0000-4000-8000-000000000001' },
      include: { permissions: { include: { permission: true } } },
    });
    assert.equal(source.length, 5);
    assert(
      source
        .find((r) => r.key === 'client')
        .permissions.some(
          ({ permission }) => permission.resource === 'clients' && permission.action === 'view',
        ),
      'Seed client lacks canonical clients:view',
    );
    const permissions = new Map();
    for (const role of source) {
      const copied = await db.role.create({
        data: { organizationId: org.id, key: role.key, name: role.name, isSystem: true },
      });
      for (const { permission } of role.permissions) {
        const key = permission.resource + ':' + permission.action;
        if (!permissions.has(key))
          permissions.set(
            key,
            await db.permission.create({
              data: {
                organizationId: org.id,
                resource: permission.resource,
                action: permission.action,
              },
            }),
          );
        await db.rolePermission.create({
          data: {
            organizationId: org.id,
            roleId: copied.id,
            permissionId: permissions.get(key).id,
          },
        });
      }
    }
    return org.id;
  }
  async function actor(org, key = 'administrator', clientId) {
    const email = 'identity-' + randomUUID() + '@example.invalid',
      password = 'Synthetic-' + randomUUID() + '!';
    const { data, error } = await storage.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    assert.equal(error, null);
    const profileId = data.user.id;
    await db.profile.upsert({
      where: { id: profileId },
      create: { id: profileId, email, fullName: 'Synthetic identity QA' },
      update: {},
    });
    const user = await db.user.create({
      data: {
        organizationId: org,
        authUserId: profileId,
        email,
        fullName: 'Synthetic identity QA',
        status: 'ACTIVE',
        ...(clientId ? { clientId } : {}),
      },
    });
    const role = await db.role.findUniqueOrThrow({
      where: { organizationId_key: { organizationId: org, key } },
    });
    const member = await db.organizationMember.create({
      data: {
        organizationId: org,
        userId: user.id,
        profileId,
        status: 'ACTIVE',
        ...(clientId ? { clientId } : {}),
        roles: { create: { organizationId: org, roleId: role.id } },
      },
    });
    const auth = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await auth.auth.signInWithPassword({ email, password });
    assert.equal(login.error, null);
    return {
      org,
      userId: user.id,
      memberId: member.id,
      profileId,
      token: login.data.session.access_token,
    };
  }
  try {
    const applied = await db.$queryRawUnsafe(
      "SELECT version FROM supabase_migrations.schema_migrations WHERE version='20261112120000'",
    );
    assert.equal(applied.length, 1, 'DEF017 migration must actually be applied');
    evidence.storagePolicies = await db.$queryRawUnsafe(
      "SELECT policyname,permissive,roles::text AS roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname",
    );
    evidence.databaseIdentity = await db.$queryRawUnsafe(
      'SELECT current_user::text AS role,current_database()::text AS database',
    );
    evidence.def017Migration = applied;
    assert.equal((await fetch(env.NEXT_PUBLIC_API_URL + '/health/ready')).status, 200);
    const orgA = await organization(),
      orgB = await organization();
    const owner = await actor(orgA),
      foreign = await actor(orgB);
    let client, document;
    const approved = {
      type: 'PERSON',
      displayName: 'APROVADO MANUAL SINTETICO',
      taxId: '529.982.247-25',
      email: 'client@example.invalid',
      customFields: {
        legalIdentity: { identityDocument: 'MG-1234567 · SSP/MG', birthDate: '1990-05-24' },
        preserved: 'synthetic-extension',
      },
    };
    await check('ID-PERSIST-CREATE', async () => {
      client = expectStatus(
        await request(owner, '/clients', { method: 'POST', body: approved }),
        201,
      );
      const row = await db.client.findUniqueOrThrow({ where: { id: client.id } });
      active.persisted = row;
      assert.equal(row.taxIdNormalized, '52998224725');
      assert.deepEqual(row.customFields, approved.customFields);
      assert(
        (await db.auditLog.count({
          where: {
            organizationId: orgA,
            resource: 'client',
            resourceId: client.id,
            action: 'CREATE',
          },
        })) > 0,
      );
      expectStatus(await request(owner, '/clients/' + client.id), 200);
    });
    assert(client, 'Fixture creation failed');
    await check('ID-DUPLICATE', async () => {
      expectStatus(
        await request(owner, '/clients', {
          method: 'POST',
          body: { ...approved, taxId: '52998224725' },
        }),
        409,
      );
      expectStatus(await request(foreign, '/clients', { method: 'POST', body: approved }), 201);
      expectStatus(
        await request(owner, '/clients', {
          method: 'POST',
          body: { ...approved, taxId: '11111111111' },
        }),
        400,
      );
      assert.equal(
        await db.client.count({ where: { organizationId: orgA, taxIdNormalized: '52998224725' } }),
        1,
      );
    });
    await check('ID-DUPLICATE-CONCURRENT', async () => {
      const payload = { ...approved, taxId: '11144477735' };
      const responses = await Promise.all([
        request(owner, '/clients', { method: 'POST', body: payload }),
        request(owner, '/clients', { method: 'POST', body: payload }),
      ]);
      assert.deepEqual(responses.map((r) => r.http).sort(), [201, 409]);
      expectStatus(await request(owner, '/clients', { method: 'POST', body: payload }), 409);
      assert.equal(
        await db.client.count({ where: { organizationId: orgA, taxIdNormalized: '11144477735' } }),
        1,
      );
      expectStatus(
        await request(owner, '/clients/' + client.id, {
          method: 'PATCH',
          body: { taxId: '11144477735' },
        }),
        409,
      );
    });
    await check('ID-EDIT-REOPEN', async () => {
      expectStatus(
        await request(owner, '/clients/' + client.id, {
          method: 'PATCH',
          body: {
            displayName: 'REVISAO CONFIRMADA',
            email: '',
            phone: '',
            customFields: approved.customFields,
          },
        }),
        200,
      );
      const row = await db.client.findUniqueOrThrow({ where: { id: client.id } });
      assert.equal(row.email, null);
      assert.equal(row.phone, null);
      const api = expectStatus(await request(owner, '/clients/' + client.id + '/overview'), 200);
      assert.equal(api.client.displayName, row.displayName);
      assert.deepEqual(api.client.customFields, row.customFields);
      active.persisted = row;
    });
    await check('ID-EDIT-CONCURRENT', async () => {
      const before = await db.client.findUniqueOrThrow({ where: { id: client.id } });
      active.before = before;
      const responses = await Promise.all(
        ['SYNTHETIC EDIT A', 'SYNTHETIC EDIT B'].map((displayName) =>
          request(owner, '/clients/' + client.id, {
            method: 'PATCH',
            body: { displayName, expectedUpdatedAt: before.updatedAt.toISOString() },
          }),
        ),
      );
      assert.deepEqual(responses.map((r) => r.http).sort(), [200, 409]);
      const after = await db.client.findUniqueOrThrow({ where: { id: client.id } });
      active.after = after;
      assert.equal(after.displayName, responses.find((r) => r.http === 200).body.displayName);
      expectStatus(
        await request(owner, '/clients/' + client.id, {
          method: 'PATCH',
          body: { displayName: 'STALE RETRY', expectedUpdatedAt: before.updatedAt.toISOString() },
        }),
        409,
      );
    });
    await check('ID-COMPANY-CONTACT-ARCHIVE', async () => {
      const company = expectStatus(
        await request(owner, '/clients', {
          method: 'POST',
          body: {
            type: 'COMPANY',
            displayName: 'EMPRESA SINTETICA',
            legalName: 'EMPRESA SINTETICA LTDA',
            taxId: '04.252.011/0001-10',
            address: { city: 'CIDADE TESTE', state: 'SP' },
            customFields: {
              legalRepresentative: { name: 'REPRESENTANTE SINTETICO', taxId: '11144477735' },
            },
          },
        }),
        201,
      );
      const contact = expectStatus(
        await request(owner, '/clients/' + company.id + '/contacts', {
          method: 'POST',
          body: { name: 'CONTATO SINTETICO', isPrimary: true },
        }),
        201,
      );
      expectStatus(
        await request(owner, '/clients/' + company.id + '/contacts/' + contact.id, {
          method: 'PATCH',
          body: { phone: '123456' },
        }),
        200,
      );
      const row = await db.client.findUniqueOrThrow({ where: { id: company.id } });
      assert.equal(row.taxIdNormalized, '04252011000110');
      assert.equal(row.address.city, 'CIDADE TESTE');
      expectStatus(await request(owner, '/clients/' + company.id, { method: 'DELETE' }), 204);
      assert((await db.client.findUniqueOrThrow({ where: { id: company.id } })).deletedAt);
      assert.equal(
        await db.clientContact.count({ where: { clientId: company.id } }),
        1,
        'Soft-delete retention is intentional',
      );
    });
    const canvas = createCanvas(800, 400),
      ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 800, 400);
    ctx.fillStyle = '#111';
    ctx.font = '30px Arial';
    ctx.fillText('TESTE SINTETICO SEM VALIDADE', 30, 70);
    const png = canvas.toBuffer('image/png');
    const upload = (clientId, bytes = png, type = 'image/png') => {
      const f = new FormData();
      f.append(
        'file',
        new Blob([bytes], { type }),
        type === 'application/pdf' ? 'synthetic.pdf' : 'synthetic.png',
      );
      f.append('title', 'Synthetic identity evidence');
      f.append('category', 'IDENTIFICACAO');
      f.append('visibility', 'INTERNAL');
      f.append('clientId', clientId);
      return f;
    };
    await check('ID-DOCUMENT-LINK-STORAGE', async () => {
      document = expectStatus(
        await request(owner, '/documents', { method: 'POST', body: upload(client.id) }),
        201,
      );
      const row = await db.document.findUniqueOrThrow({
        where: { id: document.id },
        include: { versions: true },
      });
      assert.equal(row.clientId, client.id);
      assert.equal(row.organizationId, orgA);
      assert.equal(row.versions[0].sha256, createHash('sha256').update(png).digest('hex'));
      const signed = expectStatus(
        await request(owner, '/documents/' + document.id + '/download-url'),
        200,
      );
      const url = new URL(signed.url);
      assert(['localhost', '127.0.0.1'].includes(url.hostname));
      const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
      assert.deepEqual(bytes, png);
      active.document = {
        id: row.id,
        clientId: row.clientId,
        version: row.versions[0].id,
        sha256: row.versions[0].sha256,
      };
    });
    await check('ID-PDF-GENERAL-DOCUMENT-ONLY', async () => {
      const pdf = await PDFDocument.create();
      pdf.addPage().drawText('SYNTHETIC TEST - NO LEGAL VALIDITY');
      pdf.addPage().drawText('SYNTHETIC BACK PAGE');
      const bytes = Buffer.from(await pdf.save());
      const created = expectStatus(
        await request(owner, '/documents', {
          method: 'POST',
          body: upload(client.id, bytes, 'application/pdf'),
        }),
        201,
      );
      const version = await db.documentVersion.findFirstOrThrow({
        where: { documentId: created.id },
      });
      assert.equal(version.mimeType, 'application/pdf');
      assert.equal(version.sha256, createHash('sha256').update(bytes).digest('hex'));
      active.scope = 'General document upload, not identity PDF OCR';
    });
    await check('ID-INVALID-UPLOADS', async () => {
      const before = await db.document.count({ where: { organizationId: orgA } });
      const storageCount = async () =>
        (
          await db.$queryRawUnsafe(
            'SELECT count(*)::integer AS count FROM storage.objects WHERE bucket_id=$1 AND name LIKE $2',
            'legal-documents',
            `organizations/${orgA}/%`,
          )
        )[0].count;
      const objectsBefore = await storageCount();
      active.before = { documents: before, objects: objectsBefore };
      const oversized = Buffer.alloc(4 * 1024 * 1024 + 1);
      png.copy(oversized);
      for (const [bytes, mime] of [
        [Buffer.from('corrupt'), 'image/png'],
        [png, 'image/jpeg'],
        [oversized, 'image/png'],
      ]) {
        const r = await request(owner, '/documents', {
          method: 'POST',
          body: upload(client.id, bytes, mime),
        });
        assert([400, 413].includes(r.http));
      }
      expectStatus(
        await request(owner, '/documents', {
          method: 'POST',
          body: upload(client.id, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), 'image/png'),
        }),
        422,
      );
      const corruptPdf = await request(owner, '/documents', {
        method: 'POST',
        body: upload(client.id, Buffer.from('%PDF-1.7\nSYNTHETIC CORRUPT PDF'), 'application/pdf'),
      });
      assert([400, 422].includes(corruptPdf.http));
      const after = await db.document.count({ where: { organizationId: orgA } });
      active.after = { documents: after, objects: await storageCount() };
      assert.equal(before, after);
      assert.equal(objectsBefore, active.after.objects);
    });
    await check('ID-PHOTO-PRIVATE-REPLACEMENT', async () => {
      const photo = new FormData();
      photo.append('file', new Blob([png], { type: 'image/png' }), 'synthetic-photo.png');
      expectStatus(
        await request(owner, '/clients/' + client.id + '/photo', { method: 'POST', body: photo }),
        201,
      );
      const row = await db.client.findUniqueOrThrow({ where: { id: client.id } });
      assert(row.photoStorageKey);
      const signed = expectStatus(
        await request(owner, '/clients/' + client.id + '/photo-url'),
        200,
      );
      const u = new URL(signed.url);
      assert(['127.0.0.1', 'localhost'].includes(u.hostname));
      assert.equal((await fetch(u)).status, 200);
      const publicAccess = await fetch(
        env.NEXT_PUBLIC_SUPABASE_URL +
          '/storage/v1/object/public/client-photos/' +
          row.photoStorageKey,
      );
      assert(publicAccess.status >= 400 && publicAccess.status < 500);
      expectStatus(
        await request(owner, '/clients/' + client.id + '/photo', { method: 'DELETE' }),
        200,
      );
      assert.equal(
        (await db.client.findUniqueOrThrow({ where: { id: client.id } })).photoStorageKey,
        null,
      );
      const gone = await storage.storage.from('client-photos').download(row.photoStorageKey);
      assert(gone.error);
      assert(
        ['400', '404'].includes(String(gone.error.statusCode)) &&
          /not found|not exist|NoSuchKey/i.test(gone.error.message),
      );
    });
    await check('ID-DIRECT-TENANT-MOVE', async () => {
      const before = await db.client.findUniqueOrThrow({ where: { id: client.id } });
      active.before = before;
      const response = await fetch(
        env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/clients?id=eq.' + client.id,
        {
          method: 'PATCH',
          headers: {
            apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            Authorization: 'Bearer ' + owner.token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ organization_id: orgB }),
        },
      );
      const error = await response.json();
      active.attempt = { http: response.status, code: error.code };
      assert(response.status >= 400 && response.status < 500);
      assert(['42501', '23514'].includes(error.code));
      const after = await db.client.findUniqueOrThrow({ where: { id: client.id } });
      active.after = after;
      assert.deepEqual(after, before);
    });
    await check('ID-ORG-AND-PERMISSION', async () => {
      expectStatus(await request(foreign, '/clients/' + client.id), 404);
      expectStatus(
        await request(foreign, '/documents', { method: 'POST', body: upload(client.id) }),
        404,
      );
      const portal = await actor(orgA, 'client', client.id);
      expectStatus(await request(portal, '/clients/' + client.id), 200);
      const before = await db.client.findUniqueOrThrow({ where: { id: client.id } });
      expectStatus(
        await request(portal, '/clients/' + client.id, {
          method: 'PATCH',
          body: { displayName: 'FORBIDDEN' },
        }),
        403,
      );
      assert.deepEqual(await db.client.findUniqueOrThrow({ where: { id: client.id } }), before);
      await db.organizationMember.update({
        where: { id: portal.memberId },
        data: { status: 'SUSPENDED' },
      });
      expectStatus(await request(portal, '/clients/' + client.id), 401);
      expectStatus(
        await request({ ...owner, token: 'invalid-synthetic-token' }, '/clients/' + client.id),
        401,
      );
    });
    await check('ID-RLS-CLIENT-READ', async () => {
      const portal = await actor(orgA, 'client', client.id);
      const other = await db.client.findFirstOrThrow({ where: { organizationId: orgB } });
      const headers = {
        apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + portal.token,
      };
      for (const [id, expected] of [
        [client.id, [{ id: client.id }]],
        [other.id, []],
      ]) {
        const r = await fetch(
          env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/clients?id=eq.' + id + '&select=id',
          { headers },
        );
        const rows = await r.json();
        active.requests.push({ path: 'PostgREST clients', http: r.status, rows });
        assert.equal(r.status, 200);
        assert.deepEqual(rows, expected);
      }
    });
    await check('ID-DOCUMENT-DIRECT-RELINK', async () => {
      assert(document);
      const other = expectStatus(
        await request(owner, '/clients', {
          method: 'POST',
          body: { type: 'PERSON', displayName: 'SECOND SYNTHETIC CLIENT' },
        }),
        201,
      );
      const before = await db.document.findUniqueOrThrow({ where: { id: document.id } });
      active.before = before;
      const r = await fetch(
        env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/documents?id=eq.' + document.id,
        {
          method: 'PATCH',
          headers: {
            apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            Authorization: 'Bearer ' + owner.token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ client_id: other.id }),
        },
      );
      const error = await r.json();
      active.attempt = { http: r.status, code: error.code };
      assert.equal(error.code, '42501');
      assert(/permission denied/.test(error.message));
      active.after = await db.document.findUniqueOrThrow({ where: { id: document.id } });
      assert.deepEqual(active.after, before);
    });
    await check('ID-DIRECT-STORAGE-OVERWRITE', async () => {
      assert(document, 'Valid document must exist before the security probe');
      const version = await db.documentVersion.findFirstOrThrow({
        where: { documentId: document.id },
      });
      const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: 'Bearer ' + owner.token } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const changed = Buffer.concat([png, Buffer.from('SYNTHETIC UNAUTHORIZED ALTERATION')]);
      const result = await client.storage
        .from('legal-documents')
        .upload(version.storageKey, changed, { contentType: 'image/png', upsert: true });
      active.provider = { status: result.error?.statusCode ?? null, accepted: !result.error };
      const stored = await storage.storage.from('legal-documents').download(version.storageKey);
      assert.equal(stored.error, null);
      const afterHash = createHash('sha256')
        .update(Buffer.from(await stored.data.arrayBuffer()))
        .digest('hex');
      active.after = { sha256: afterHash };
      active.before = { sha256: version.sha256 };
      assert(result.error, 'Direct identity evidence overwrite was accepted');
      assert.equal(afterHash, version.sha256);
    });
    await check('ID-STORAGE-AUTHORIZATION-MATRIX', async () => {
      assert(document && client);
      await runDocumentStorageMatrix({
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
      });
    });
    await check('ID-DOCUMENT-VERSION-INTEGRITY', async () => {
      const before = await db.documentVersion.findFirstOrThrow({
        where: { documentId: document.id },
      });
      const original = await storage.storage.from('legal-documents').download(before.storageKey);
      assert.equal(original.error, null);
      const originalHash = createHash('sha256')
        .update(Buffer.from(await original.data.arrayBuffer()))
        .digest('hex');
      assert.equal(originalHash, before.sha256);
      const changed = Buffer.concat([png, Buffer.from('SYNTHETIC NEW VERSION')]);
      const form = new FormData();
      form.append('file', new Blob([changed], { type: 'image/png' }), 'version2.png');
      expectStatus(
        await request(owner, '/documents/' + document.id + '/versions', {
          method: 'POST',
          body: form,
        }),
        201,
      );
      const versions = await db.documentVersion.findMany({
        where: { documentId: document.id },
        orderBy: { version: 'asc' },
      });
      assert.equal(versions.length, 2);
      assert.notEqual(versions[0].storageKey, versions[1].storageKey);
      for (const v of versions) {
        const bytes = await storage.storage.from('legal-documents').download(v.storageKey);
        assert.equal(bytes.error, null);
        assert.equal(
          createHash('sha256')
            .update(Buffer.from(await bytes.data.arrayBuffer()))
            .digest('hex'),
          v.sha256,
        );
      }
      assert.equal(versions[0].sha256, originalHash);
      active.versions = versions.map((v) => ({
        id: v.id,
        key: v.storageKey,
        sha256: v.sha256,
        version: v.version,
      }));
      const countBefore = await db.document.count({ where: { organizationId: owner.org } });
      const objectsBefore = await db.$queryRawUnsafe(
        "SELECT count(*)::int AS count FROM storage.objects WHERE bucket_id='legal-documents'",
      );
      const eicar = Buffer.from(
        'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
      );
      const infected = await PDFDocument.create();
      infected.addPage().drawText('SYNTHETIC SCANNER TEST');
      await infected.attach(eicar, 'eicar.com', {
        mimeType: 'application/octet-stream',
        description: 'SYNTHETIC ANTIVIRUS TEST',
      });
      const infectedBytes = Buffer.from(await infected.save());
      assert.equal((await PDFDocument.load(infectedBytes)).getPageCount(), 1);
      const rejected = await request(owner, '/documents', {
        method: 'POST',
        body: upload(client.id, infectedBytes, 'application/pdf'),
      });
      assert.equal(rejected.http, 422);
      assert.match(JSON.stringify(rejected.body), /verifica.*seguran/i);
      assert.equal(await db.document.count({ where: { organizationId: owner.org } }), countBefore);
      assert.deepEqual(
        await db.$queryRawUnsafe(
          "SELECT count(*)::int AS count FROM storage.objects WHERE bucket_id='legal-documents'",
        ),
        objectsBefore,
      );
    });
    await check('ID-SIGNATURE-SERVER-STORAGE-COMPATIBILITY', async () => {
      const pdf = await PDFDocument.create();
      pdf.addPage().drawText('SYNTHETIC SIGNATURE TEST - NO LEGAL VALIDITY');
      const bytes = Buffer.from(await pdf.save());
      const source = expectStatus(
        await request(owner, '/documents', {
          method: 'POST',
          body: upload(client.id, bytes, 'application/pdf'),
        }),
        201,
      );
      const sourceVersion = await db.documentVersion.findFirstOrThrow({
        where: { documentId: source.id },
      });
      const revoked = expectStatus(
        await request(owner, '/documents/' + source.id + '/signature-requests', {
          method: 'POST',
          body: { signerName: 'SIGNATARIO SINTETICO' },
        }),
        201,
      );
      expectStatus(
        await request(owner, '/documents/signature-requests/' + revoked.id + '/revoke', {
          method: 'POST',
        }),
        201,
      );
      const revokedRead = await fetch(
        env.NEXT_PUBLIC_API_URL + '/public/signatures/' + revoked.token,
      );
      assert.equal(revokedRead.status, 410);
      active.requests.push({
        method: 'GET',
        path: '/public/signatures/[redacted]',
        http: revokedRead.status,
      });
      const link = expectStatus(
        await request(owner, '/documents/' + source.id + '/signature-requests', {
          method: 'POST',
          body: { signerName: 'SIGNATARIO SINTETICO' },
        }),
        201,
      );
      const signed = await fetch(
        env.NEXT_PUBLIC_API_URL + '/public/signatures/' + link.token + '/sign',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signerName: 'SIGNATARIO SINTETICO',
            consent: true,
            signature: 'data:image/png;base64,' + png.toString('base64'),
          }),
          signal: AbortSignal.timeout(35000),
        },
      );
      active.requests.push({
        method: 'POST',
        path: '/public/signatures/[redacted]/sign',
        http: signed.status,
      });
      assert.equal(signed.status, 201);
      const result = await signed.json();
      assert.equal(result.status, 'SIGNED');
      const row = await db.documentSigningRequest.findUniqueOrThrow({ where: { id: link.id } });
      assert.equal(row.status, 'SIGNED');
      assert.equal(row.signedDocumentId, result.signedDocumentId);
      const signedVersion = await db.documentVersion.findFirstOrThrow({
        where: { documentId: result.signedDocumentId },
      });
      for (const version of [sourceVersion, signedVersion]) {
        const download = await storage.storage.from('legal-documents').download(version.storageKey);
        assert.equal(download.error, null);
        assert.equal(
          createHash('sha256')
            .update(Buffer.from(await download.data.arrayBuffer()))
            .digest('hex'),
          version.sha256,
        );
      }
      const signature = await storage.storage
        .from('document-signatures')
        .download(row.signatureStorageKey);
      assert.equal(signature.error, null);
      assert.equal(
        createHash('sha256')
          .update(Buffer.from(await signature.data.arrayBuffer()))
          .digest('hex'),
        row.signatureSha256,
      );
      assert((await db.auditLog.count({ where: { resourceId: link.id, action: 'UPDATE' } })) > 0);
      assert(
        (await db.auditLog.count({ where: { resourceId: revoked.id, action: 'CANCEL' } })) > 0,
      );
      active.result = {
        sourceDocumentId: source.id,
        signedDocumentId: result.signedDocumentId,
        signatureSha256: row.signatureSha256,
      };
    });
    evidence.setup = 'PASS';
  } catch (error) {
    evidence.setup = { status: 'FAIL', name: error.name, code: error.code ?? null };
  } finally {
    await db.$disconnect();
    save();
  }
  if (evidence.setup !== 'PASS' || evidence.cases.some((c) => c.status !== 'PASS'))
    throw new Error('Identity integration failed; preserve individual sanitized evidence');
  return evidence;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runIdentityIntegrity()
    .then((r) =>
      console.log(
        JSON.stringify({
          cases: r.cases.length,
          passed: r.cases.filter((c) => c.status === 'PASS').length,
        }),
      ),
    )
    .catch(() => {
      console.error('Identity integration refused or failed; no hosted credential logged.');
      process.exitCode = 1;
    });
}
