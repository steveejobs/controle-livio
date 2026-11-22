import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateIdentityEnvironment } from './identity-environment.mjs';

// Reuses real disposable actors/API/Prisma/Storage from the identity runner.
// Trusted fixture mutations model legacy/broken memberships, not public endpoints.
export async function runClientScopeIntegrity({
  env,
  db,
  storage,
  actor,
  owner,
  foreign,
  client,
  document,
  request,
  upload,
}) {
  validateIdentityEnvironment(env, process.cwd());
  const report = {
    scope: 'REAL_AUTH_API_POSTGRESQL_RLS_STORAGE',
    cases: [],
    probes: [],
    setup: 'FAIL',
  };
  const save = () =>
    writeFileSync(
      resolve(env.LIVIO_QA_OUTPUT, 'workflow-stages/client-scope-stage54.json'),
      JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n',
    );
  save();
  const applied = await db.$queryRawUnsafe(
    "SELECT version FROM supabase_migrations.schema_migrations WHERE version='20261112140000'",
  );
  assert.equal(applied.length, 1, 'Client scope migration must actually be applied');
  report.migration = applied;
  const otherResponse = await request(owner, '/clients', {
    method: 'POST',
    body: { type: 'PERSON', displayName: 'SYNTHETIC SCOPE OTHER' },
  });
  assert.equal(otherResponse.http, 201);
  const other = otherResponse.body;
  const foreignResponse = await request(foreign, '/clients', {
    method: 'POST',
    body: { type: 'PERSON', displayName: 'SYNTHETIC FOREIGN SCOPE' },
  });
  assert.equal(foreignResponse.http, 201);
  const contact = await request(owner, `/clients/${client.id}/contacts`, {
    method: 'POST',
    body: { name: 'SYNTHETIC SCOPE CONTACT' },
  });
  assert.equal(contact.http, 201);
  const docs = [];
  for (const c of [client, other]) {
    const body = upload(c.id);
    body.set('visibility', 'CLIENT');
    const created = await request(owner, '/documents', { method: 'POST', body });
    assert.equal(created.http, 201);
    docs.push(created.body);
  }
  const portal = await actor(owner.org, 'client', client.id);
  const roles = await db.role.findMany({ where: { organizationId: owner.org } });
  const role = (key) => roles.find((r) => r.key === key).id;
  async function rest(identity, path, options = {}) {
    const response = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/' + path, {
      ...options,
      headers: {
        apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + identity.token,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
    return { http: response.status, body: await response.json() };
  }
  async function snapshot() {
    const where = { organizationId: owner.org };
    return {
      clients: await db.client.findMany({ where, orderBy: { id: 'asc' } }),
      contacts: await db.clientContact.findMany({ where, orderBy: { id: 'asc' } }),
      documents: await db.document.findMany({ where, orderBy: { id: 'asc' } }),
      versions: await db.documentVersion.findMany({ where, orderBy: { id: 'asc' } }),
      audit: await db.auditLog.findMany({ where, orderBy: { id: 'asc' } }),
    };
  }
  async function verify(identity, scope) {
    const probe = {
      profileId: identity.profileId,
      membershipId: identity.memberId,
      organizationId: identity.org,
      expectedScope: scope,
      api: [],
      sql: [],
    };
    report.probes.push(probe);
    const valid = await storage.auth.getUser(identity.token);
    assert.equal(valid.error, null, 'Security probe requires valid real Auth credentials');
    assert.equal(valid.data.user.id, identity.profileId);
    const api = probe.api;
    for (const path of [
      '/auth/me',
      '/clients?page=1&pageSize=100',
      `/clients/${client.id}`,
      `/clients/${other.id}`,
      `/clients/${client.id}/overview`,
      `/clients/${other.id}/overview`,
      '/documents?page=1&pageSize=100',
      `/documents/${docs[0].id}`,
      `/documents/${docs[1].id}`,
      `/documents/${document.id}`,
      `/documents/${docs[0].id}/download-url`,
      `/documents/${docs[1].id}/download-url`,
    ]) {
      const r = await request(identity, path);
      api.push({ path, http: r.http, code: r.body?.code ?? null });
      save();
      const foreignRecord =
        path === `/clients/${other.id}` ||
        path === `/clients/${other.id}/overview` ||
        path === `/documents/${docs[1].id}` ||
        path === `/documents/${docs[1].id}/download-url` ||
        path === `/documents/${document.id}`;
      assert.equal(
        r.http,
        scope === 'denied' ? 401 : scope === 'client' && foreignRecord ? 404 : 200,
      );
      if (path.startsWith('/clients?') && scope === 'client') {
        assert.deepEqual(
          r.body.items.map((c) => c.id),
          [client.id],
        );
        assert.equal(r.body.total, 1);
      }
      if (path === `/clients/${client.id}` && scope !== 'denied')
        assert(r.body.contacts.some((c) => c.id === contact.body.id));
      if (path.startsWith('/documents?') && scope === 'client')
        assert(r.body.items.every((d) => d.clientId === client.id && d.visibility === 'CLIENT'));
    }
    const sql = probe.sql;
    for (const table of ['clients', 'client_contacts', 'documents', 'document_versions']) {
      const r = await rest(identity, table + '?select=*&organization_id=eq.' + owner.org);
      sql.push({
        table,
        http: r.http,
        ids: Array.isArray(r.body) ? r.body.map((row) => row.id) : [],
        code: r.body?.code ?? null,
      });
      save();
      assert.equal(r.http, 200);
      if (scope === 'denied') assert.deepEqual(r.body, []);
      else if (scope === 'client') {
        const ids =
          table === 'clients'
            ? [client.id]
            : table === 'client_contacts'
              ? [contact.body.id]
              : table === 'documents'
                ? [docs[0].id]
                : (await db.documentVersion.findMany({ where: { documentId: docs[0].id } })).map(
                    (v) => v.id,
                  );
        assert.deepEqual(r.body.map((row) => row.id).sort(), ids.sort());
      } else if (table === 'clients') assert(r.body.some((row) => row.id === other.id));
    }
    const permission = await rest(identity, 'rpc/has_permission', {
      method: 'POST',
      body: JSON.stringify({
        target_organization_id: owner.org,
        target_resource: 'clients',
        target_action: 'view',
      }),
    });
    assert.equal(permission.http, 200);
    assert.equal(permission.body, scope !== 'denied');
    const organizations = await rest(identity, 'rpc/current_organization_ids', {
      method: 'POST',
      body: '{}',
    });
    assert.equal(organizations.http, 200);
    assert.deepEqual(organizations.body, scope === 'denied' ? [] : [owner.org]);
    if (scope !== 'staff') {
      const patched = await request(identity, `/clients/${client.id}`, {
        method: 'PATCH',
        body: { displayName: 'FORBIDDEN SCOPE CHANGE' },
      });
      assert.equal(patched.http, scope === 'denied' ? 401 : 403);
      api.push({ method: 'PATCH', path: '/clients/[fixture]', http: patched.http });
    }
    const bytes = [];
    probe.storage = [];
    for (const [index, d] of docs.entries()) {
      const v = await db.documentVersion.findFirstOrThrow({ where: { documentId: d.id } });
      const stored = await storage.storage.from('legal-documents').download(v.storageKey);
      assert.equal(stored.error, null);
      const sha = createHash('sha256')
        .update(Buffer.from(await stored.data.arrayBuffer()))
        .digest('hex');
      assert.equal(sha, v.sha256);
      // Same GET path used by storage-js 2.112.2; no signed capability or server
      // credential in the user request. An admin read proves the object exists.
      const response = await fetch(
        env.NEXT_PUBLIC_SUPABASE_URL +
          '/storage/v1/object/legal-documents/' +
          encodeURI(v.storageKey),
        {
          headers: {
            apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            Authorization: 'Bearer ' + identity.token,
          },
          signal: AbortSignal.timeout(15000),
        },
      );
      const allowed = scope === 'staff' || (scope === 'client' && index === 0);
      const storageProbe = {
        documentId: d.id,
        key: v.storageKey,
        expectedRead: allowed,
        http: response.status,
        beforeSha256: sha,
      };
      probe.storage.push(storageProbe);
      save();
      if (response.ok) {
        storageProbe.observedSha256 = createHash('sha256')
          .update(Buffer.from(await response.arrayBuffer()))
          .digest('hex');
        save();
        assert(allowed, 'Unauthorized direct Storage read accepted');
        assert.equal(storageProbe.observedSha256, sha);
      } else {
        const body = await response.json();
        storageProbe.code = body.code ?? body.statusCode ?? null;
        save();
        assert(!allowed, 'Legitimate private Storage read rejected');
        const message = String(body.message ?? body.error ?? '');
        assert.match(
          message,
          /not found|not exist|NoSuchKey|row.level security|access denied|not authorized|unauthori[sz]ed/i,
        );
        assert.doesNotMatch(message, /invalid.*(?:jwt|token)|expired.*(?:jwt|token)/i);
      }
      const preserved = await storage.storage.from('legal-documents').download(v.storageKey);
      assert.equal(preserved.error, null);
      storageProbe.afterSha256 = createHash('sha256')
        .update(Buffer.from(await preserved.data.arrayBuffer()))
        .digest('hex');
      assert.equal(storageProbe.afterSha256, sha);
      bytes.push({ documentId: d.id, key: v.storageKey, sha256: sha });
    }
    return { api, sql, bytes, effectivePermission: permission.body };
  }
  const run = async (id, fn) => {
    const c = { id, status: 'FAIL', fixtureMutations: 'trusted disposable database only' };
    report.cases.push(c);
    try {
      c.before = await snapshot();
      await fn(c);
      c.after = await snapshot();
      assert.deepEqual(c.after, c.before);
      c.status = 'PASS';
    } catch (error) {
      c.error = { name: error.name, code: error.code ?? null };
      c.after = await snapshot();
    }
    save();
  };
  await run('SCOPE54-BOUND', async (c) => {
    c.result = await verify(portal, 'client');
  });
  await run('SCOPE54-UNBOUND', async (c) => {
    const usersBefore = await db.user.count({ where: { organizationId: owner.org } });
    const invalid = await request(owner, '/admin/users', {
      method: 'POST',
      body: {
        fullName: 'SYNTHETIC UNBOUND',
        email: `unbound-${randomUUID()}@example.test`,
        roleIds: [role('client')],
      },
    });
    assert.equal(invalid.http, 400);
    assert.equal(await db.user.count({ where: { organizationId: owner.org } }), usersBefore);
    const unbound = await actor(owner.org, 'client');
    c.result = await verify(unbound, 'denied');
    await db.organizationMember.update({
      where: { id: unbound.memberId },
      data: { status: 'SUSPENDED' },
    });
    const reactivation = await request(owner, `/admin/users/${unbound.userId}/status`, {
      method: 'PATCH',
      body: { status: 'ACTIVE' },
    });
    assert.equal(reactivation.http, 400);
    assert.equal(
      (await db.organizationMember.findUniqueOrThrow({ where: { id: unbound.memberId } })).status,
      'SUSPENDED',
    );
    c.reactivation = { http: reactivation.http, status: 'SUSPENDED' };
  });
  await run('SCOPE54-FOREIGN-BINDING', async (c) => {
    const response = await request(owner, '/admin/users', {
      method: 'POST',
      body: {
        fullName: 'SYNTHETIC FOREIGN',
        email: `foreign-${randomUUID()}@example.test`,
        roleIds: [role('client')],
        clientId: foreignResponse.body.id,
      },
    });
    assert.equal(response.http, 404);
    const broken = await actor(owner.org, 'client', client.id);
    let legacyBindingCreated = false;
    try {
      await db.$executeRawUnsafe(
        'UPDATE public.organization_members SET client_id=$1::uuid WHERE id=$2::uuid',
        foreignResponse.body.id,
        broken.memberId,
      );
      legacyBindingCreated = true;
    } catch (error) {
      c.constraint = { code: error.code, sqlState: error.meta?.code };
      assert.equal(error.meta?.code, '23514');
    }
    c.legacyBindingCreated = legacyBindingCreated;
    if (legacyBindingCreated) {
      try {
        assert.equal(
          (await db.organizationMember.findUniqueOrThrow({ where: { id: broken.memberId } }))
            .clientId,
          foreignResponse.body.id,
        );
        c.invalidBinding = await verify(broken, 'denied');
      } finally {
        await db.organizationMember.update({
          where: { id: broken.memberId },
          data: { clientId: client.id },
        });
      }
    }
    assert.equal(
      (await db.organizationMember.findUniqueOrThrow({ where: { id: portal.memberId } })).clientId,
      client.id,
    );
    const cross = await request(
      { ...portal, org: foreign.org },
      '/clients/' + foreignResponse.body.id,
    );
    assert.equal(cross.http, 401);
    c.result = await verify(portal, 'client');
  });
  await run('SCOPE54-SUSPENDED', async (c) => {
    const suspended = await actor(owner.org, 'client', client.id);
    await db.organizationMember.update({
      where: { id: suspended.memberId },
      data: { status: 'SUSPENDED' },
    });
    c.result = await verify(suspended, 'denied');
  });
  await run('SCOPE54-REMOVED-BINDING', async (c) => {
    const removed = await actor(owner.org, 'client', client.id);
    await verify(removed, 'client');
    await db.organizationMember.update({
      where: { id: removed.memberId },
      data: { clientId: null },
    });
    c.result = await verify(removed, 'denied');
  });
  await run('SCOPE54-SELF-ROLE', async (c) => {
    const before = await db.organizationMemberRole.findMany({
      where: { membershipId: portal.memberId },
    });
    const denied = await request(portal, '/admin/users', {
      method: 'POST',
      body: {
        fullName: 'SYNTHETIC ESCALATION',
        email: `escalation-${randomUUID()}@example.test`,
        roleIds: [role('administrator')],
      },
    });
    assert.equal(denied.http, 403);
    const direct = await rest(portal, 'organization_member_roles', {
      method: 'POST',
      body: JSON.stringify({
        organization_id: owner.org,
        membership_id: portal.memberId,
        role_id: role('administrator'),
      }),
    });
    assert.equal(direct.body.code, '42501');
    assert([401, 403].includes(direct.http));
    assert.deepEqual(
      await db.organizationMemberRole.findMany({ where: { membershipId: portal.memberId } }),
      before,
    );
    c.denial = { http: direct.http, code: direct.body.code };
    c.result = await verify(portal, 'client');
  });
  await run('SCOPE54-STAFF', async (c) => {
    c.result = await verify(await actor(owner.org, 'lawyer'), 'staff');
  });
  await run('SCOPE54-MULTI', async (c) => {
    const multi = await actor(owner.org, 'client', client.id);
    await db.organizationMemberRole.create({
      data: { organizationId: owner.org, membershipId: multi.memberId, roleId: role('lawyer') },
    });
    c.result = await verify(multi, 'staff');
    const custom = await db.role.create({
      data: {
        organizationId: owner.org,
        key: 'scope-' + randomUUID(),
        name: 'Synthetic unclassified role',
      },
    });
    await db.$transaction(async (tx) => {
      await tx.organizationMemberRole.deleteMany({
        where: { membershipId: multi.memberId, roleId: role('lawyer') },
      });
      await tx.organizationMemberRole.create({
        data: { organizationId: owner.org, membershipId: multi.memberId, roleId: custom.id },
      });
    });
    c.customBound = await verify(multi, 'client');
    await db.organizationMember.update({ where: { id: multi.memberId }, data: { clientId: null } });
    c.customUnbound = await verify(multi, 'denied');
    await db.organizationMember.update({
      where: { id: multi.memberId },
      data: { clientId: client.id },
    });
    const foreignRole = await db.role.findUniqueOrThrow({
      where: { organizationId_key: { organizationId: foreign.org, key: 'lawyer' } },
    });
    let foreignRoleFixtureCreated = false;
    try {
      await db.$executeRawUnsafe(
        'INSERT INTO public.organization_member_roles (organization_id,membership_id,role_id) VALUES ($1::uuid,$2::uuid,$3::uuid)',
        owner.org,
        multi.memberId,
        foreignRole.id,
      );
      foreignRoleFixtureCreated = true;
    } catch (error) {
      c.foreignRoleConstraint = { code: error.code, sqlState: error.meta?.code };
      assert.equal(error.meta?.code, '23514');
    }
    c.foreignRoleFixtureCreated = foreignRoleFixtureCreated;
    if (foreignRoleFixtureCreated) {
      try {
        c.foreignRoleDenied = await verify(multi, 'denied');
      } finally {
        await db.organizationMemberRole.deleteMany({
          where: { membershipId: multi.memberId, roleId: foreignRole.id },
        });
      }
    }
    c.recoveredBoundScope = await verify(multi, 'client');
  });
  await run('SCOPE54-NO-ACTIVE-MEMBERSHIP', async (c) => {
    const archived = await actor(owner.org, 'client', client.id);
    await db.organizationMember.update({
      where: { id: archived.memberId },
      data: { status: 'ARCHIVED' },
    });
    c.result = await verify(archived, 'denied');
  });
  await run('SCOPE54-OLD-TOKEN-ROLE-CHANGE', async (c) => {
    const changed = await actor(owner.org, 'lawyer');
    await verify(changed, 'staff');
    await db.$transaction(async (tx) => {
      await tx.organizationMemberRole.deleteMany({ where: { membershipId: changed.memberId } });
      await tx.organizationMemberRole.create({
        data: { organizationId: owner.org, membershipId: changed.memberId, roleId: role('client') },
      });
    });
    c.result = await verify(changed, 'denied');
  });
  report.setup = 'PASS';
  save();
  assert.equal(report.cases.length, 10);
  assert(
    report.cases.every((c) => c.status === 'PASS'),
    'Client scope integrity failed; retain individual evidence',
  );
  return report;
}
