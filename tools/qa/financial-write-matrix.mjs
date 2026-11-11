import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';

export const financialTables = [
  'contracts',
  'receivables',
  'receivable_installments',
  'payments',
  'payment_allocations',
  'payment_reversals',
  'payment_change_requests',
  'financial_adjustments',
  'renegotiations',
  'expenses',
  'payment_receipts',
  'audit_logs',
];

export function rawRecord(model, row) {
  return Object.fromEntries(
    model.fields
      .filter((f) => f.kind !== 'object' && f.name in row)
      .map((f) => [f.dbName ?? f.name, JSON.parse(JSON.stringify(row[f.name]))]),
  );
}

export function denialKind(status, body) {
  if (status === 401 && body.code !== '42501') return 'AUTHENTICATION_FAILURE';
  if (body.code === '42501' && /permission denied for (table|column)/i.test(body.message ?? ''))
    return 'PRIVILEGE_DENIED';
  if (body.code === '42501' && /row.level security/i.test(body.message ?? '')) return 'RLS_DENIED';
  if (status >= 200 && status < 300) return 'WRITE_ACCEPTED';
  return 'HARNESS_OR_DOMAIN_FAILURE';
}

// Called only after validateFinancialEnvironment by the existing disposable runner.
export async function runWriteMatrix({
  database,
  Prisma,
  env,
  actor,
  fixture,
  organizations,
  check,
  state,
  api,
}) {
  const owner = await actor(organizations[0]);
  const f = await fixture(owner);
  const now = () => new Date();
  const org = { organizationId: owner.organizationId };
  const parentMatter = await database.matter.create({
    data: {
      ...org,
      clientId: f.clientId,
      reference: randomUUID(),
      title: 'Synthetic identity parent',
    },
  });
  for (const [table, id] of [
    ['clients', f.clientId],
    ['matters', parentMatter.id],
  ]) {
    for (const payload of [{ id: randomUUID() }, { organization_id: organizations[1] }]) {
      await check(
        `INDIRECT-PARENT-${table}-${Object.keys(payload)[0]}`,
        'Identity cascades cannot mutate financial children',
        async () => {
          const person = await actor(organizations[0], 'lawyer');
          const [before] = await database.$queryRawUnsafe(
            `SELECT to_jsonb(t)::text AS row FROM public."${table}" t WHERE id=$1::uuid`,
            id,
          );
          const response = await fetch(
            `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`,
            {
              method: 'PATCH',
              headers: {
                apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
                Authorization: `Bearer ${person.token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payload),
            },
          );
          const body = await response.json();
          state('attempt', {
            table,
            id,
            payload,
            http: response.status,
            code: body.code,
            message: body.message,
          });
          // Tenant movement may be denied by RLS before the identity trigger; both are explicit.
          assert.ok(['23514', '42501'].includes(body.code));
          assert.ok(response.status >= 400 && response.status < 500);
          const [after] = await database.$queryRawUnsafe(
            `SELECT to_jsonb(t)::text AS row FROM public."${table}" t WHERE id=$1::uuid`,
            id,
          );
          state('before', before);
          state('after', after);
          assert.deepEqual(after, before);
          assert.equal(
            await database.receivable.count({
              where: {
                id: f.receivableId,
                clientId: f.clientId,
                organizationId: owner.organizationId,
              },
            }),
            1,
          );
        },
      );
    }
  }
  const paymentData = () => ({
    ...org,
    clientId: f.clientId,
    reference: randomUUID(),
    amount: '25.00',
    currency: 'BRL',
    paidAt: now(),
    method: 'PIX',
    status: 'CONFIRMED',
    confirmedById: owner.userId,
    confirmedAt: now(),
    idempotencyKey: randomUUID(),
    idempotencyHash: 'a'.repeat(64),
  });
  const makers = {
    contracts: async () => ({
      ...org,
      clientId: f.clientId,
      number: randomUUID(),
      title: 'Synthetic contract',
      feeModel: 'FIXED',
    }),
    receivables: async () => ({
      ...org,
      clientId: f.clientId,
      reference: randomUUID(),
      description: 'Synthetic debt',
      originalAmount: '100.00',
      issueDate: now(),
      dueDate: now(),
    }),
    receivable_installments: async () => {
      const debt = await database.receivable.create({ data: await makers.receivables() });
      return { ...org, receivableId: debt.id, sequence: 1, amount: '100.00', dueDate: now() };
    },
    payments: async () => paymentData(),
    payment_allocations: async () => {
      const payment = await database.payment.create({ data: paymentData() });
      // Dedicated installment avoids capacity interference between controls.
      const installment = await database.receivableInstallment.create({
        data: await makers.receivable_installments(),
      });
      return {
        ...org,
        paymentId: payment.id,
        installmentId: installment.id,
        amount: '25.00',
        createdById: owner.userId,
      };
    },
    payment_reversals: async () => ({
      ...org,
      originalPaymentId: (await database.payment.create({ data: paymentData() })).id,
      amount: '25.00',
      reason: 'Synthetic reversal',
      reversedById: owner.userId,
    }),
    payment_change_requests: async () => ({
      ...org,
      paymentId: (await database.payment.create({ data: paymentData() })).id,
      createdById: owner.userId,
      proposedData: { amount: '20.00' },
      reason: 'Synthetic correction',
    }),
    financial_adjustments: async () => ({
      ...org,
      installmentId: f.installmentId,
      kind: 'DISCOUNT',
      amount: '1.00',
      reason: 'Synthetic adjustment',
      effectiveAt: now(),
      createdById: owner.userId,
    }),
    renegotiations: async () => ({
      ...org,
      originalReceivableId: f.receivableId,
      reason: 'Synthetic renegotiation',
      createdById: owner.userId,
    }),
    expenses: async () => ({
      ...org,
      clientId: f.clientId,
      description: 'Synthetic expense',
      category: 'QA',
      amount: '25.00',
      incurredAt: now(),
      createdById: owner.userId,
    }),
    payment_receipts: async () => {
      const doc = await database.document.create({
        data: {
          ...org,
          clientId: f.clientId,
          installmentId: f.installmentId,
          title: 'Synthetic evidence',
          createdById: owner.userId,
        },
      });
      await database.documentVersion.create({
        data: {
          ...org,
          documentId: doc.id,
          version: 1,
          storageKey: `organizations/${owner.organizationId}/documents/${doc.id}/synthetic.pdf`,
          fileName: 'synthetic.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1n,
          sha256: 'a'.repeat(64),
          uploadedById: owner.userId,
        },
      });
      return {
        ...org,
        clientId: f.clientId,
        documentId: doc.id,
        installmentId: f.installmentId,
        sha256: createHash('sha256').update(randomUUID()).digest('hex'),
        submittedById: owner.userId,
      };
    },
    audit_logs: async () => ({
      ...org,
      actorUserId: owner.userId,
      action: 'CREATE',
      resource: 'synthetic_matrix',
      resourceId: randomUUID(),
    }),
  };
  const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.dbName, m]));
  const updates = {
    contracts: { fixed_amount: '200.00' },
    receivables: { original_amount: '200.00' },
    receivable_installments: { amount: '200.00' },
    payments: { status: 'REVERSED' },
    payment_allocations: { reversed_at: new Date().toISOString(), reversed_by_id: owner.userId },
    payment_reversals: { reason: 'Forbidden history rewrite' },
    payment_change_requests: {
      status: 'APPROVED',
      reviewed_by_id: owner.userId,
      reviewed_at: new Date().toISOString(),
    },
    financial_adjustments: { approved_by_id: owner.userId, approved_at: new Date().toISOString() },
    renegotiations: { status: 'APPROVED' },
    expenses: { status: 'PAID', paid_at: new Date().toISOString() },
    payment_receipts: { status: 'CONFIRMED' },
    audit_logs: { action: 'REVERSE' },
  };
  const fixtures = new Map();
  for (const table of financialTables) {
    const model = models.get(table);
    assert.ok(model, `Unknown model ${table}`);
    const delegate = model.name[0].toLowerCase() + model.name.slice(1);
    const target = await database[delegate].create({ data: await makers[table]() });
    const data = await makers[table]();
    let insert;
    const rollback = new Error('Synthetic insert control rollback');
    await assert.rejects(
      database.$transaction(async (tx) => {
        const row = await tx[delegate].create({ data });
        insert = rawRecord(model, row);
        throw rollback;
      }),
      (e) => e === rollback,
    );
    assert.ok(insert && target.id);
    // Prove the exact JSON payload also satisfies PostgreSQL, not just Prisma input.
    await assert.rejects(
      database.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO public."${table}" SELECT * FROM jsonb_populate_record(NULL::public."${table}", $1::jsonb)`,
          JSON.stringify(insert),
        );
        throw rollback;
      }),
      (e) => e === rollback,
    );
    fixtures.set(table, { target: rawRecord(model, target), insert });
  }
  const snapshot = async () => {
    const result = {};
    for (const table of [
      ...financialTables,
      'documents',
      'document_versions',
      'organizations',
      'organization_members',
      'organization_member_roles',
      'roles',
      'role_permissions',
      'users',
    ]) {
      const filter = table === 'organizations' ? 'id' : 'organization_id';
      const [row] = await database.$queryRawUnsafe(
        `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text AS rows FROM public."${table}" t WHERE ${filter}=$1::uuid`,
        owner.organizationId,
      );
      result[table] = {
        sha256: createHash('sha256').update(row.rows).digest('hex'),
        rowCount: JSON.parse(row.rows).length,
      };
    }
    return result;
  };
  // A custom role may hold granular manage permissions without being administrator.
  // The API denies that role; Data API must not let it assign the official admin role.
  const customKey = `qa-custom-${randomUUID()}`;
  const customRole = await database.role.create({
    data: { ...org, key: customKey, name: 'Synthetic custom manager' },
  });
  const permissions = await database.permission.findMany({
    where: {
      ...org,
      OR: [
        { resource: 'users', action: 'manage' },
        { resource: 'roles', action: 'manage' },
        { resource: 'organization', action: 'update' },
      ],
    },
  });
  assert.equal(permissions.length, 3);
  for (const permission of permissions)
    await database.rolePermission.create({
      data: { ...org, roleId: customRole.id, permissionId: permission.id },
    });
  const custom = await actor(organizations[0], customKey);
  const adminRole = await database.role.findUniqueOrThrow({
    where: { organizationId_key: { organizationId: owner.organizationId, key: 'administrator' } },
  });
  await check(
    'INDIRECT-CUSTOM-ROLE',
    'Granular manager cannot self-promote through memberships',
    async () => {
      assert.equal(
        (
          await api(custom, '/finance/expenses/approval-policy', {
            method: 'PATCH',
            body: { required: false },
          })
        ).status,
        403,
        'Official administrator check must remain active',
      );
      const payload = {
        organization_id: owner.organizationId,
        membership_id: custom.membershipId,
        role_id: adminRole.id,
      };
      const sentinel = new Error('Rollback valid membership insert');
      await assert.rejects(
        database.$transaction(async (tx) => {
          await tx.organizationMemberRole.create({
            data: { ...org, membershipId: custom.membershipId, roleId: adminRole.id },
          });
          throw sentinel;
        }),
        (e) => e === sentinel,
      );
      const before = await snapshot();
      state('before', before);
      const response = await fetch(
        `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/organization_member_roles`,
        {
          method: 'POST',
          headers: {
            apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${custom.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      const body = await response.json();
      state('attempt', {
        http: response.status,
        code: body.code,
        message: body.message,
        payload,
        profileId: custom.profileId,
      });
      const after = await snapshot();
      state('after', after);
      assert.deepEqual(after, before);
      assert.equal(denialKind(response.status, body), 'PRIVILEGE_DENIED');
    },
  );
  for (const role of ['administrator', 'lawyer', 'secretary', 'finance', 'client', 'anon']) {
    const person =
      role === 'anon'
        ? null
        : await actor(organizations[0], role, role === 'client' ? f.clientId : undefined);
    if (person) {
      const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
        headers: {
          apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${person.token}`,
        },
      });
      assert.equal(response.status, 200, 'Auth precondition');
      assert.equal((await response.json()).id, person.profileId);
      const membership = await database.organizationMember.findUniqueOrThrow({
        where: { id: person.membershipId },
      });
      assert.equal(membership.organizationId, owner.organizationId);
      assert.equal(membership.status, 'ACTIVE');
    }
    if (person)
      for (const table of [
        'organizations',
        'users',
        'roles',
        'permissions',
        'role_permissions',
        'organization_members',
        'organization_member_roles',
        'documents',
        'document_versions',
      ]) {
        await check(
          `INDIRECT-${role}-${table}`,
          'Auxiliary writes cannot change configuration, authorization or evidence',
          async () => {
            const model = models.get(table);
            const filter = table === 'organizations' ? 'id' : 'organization_id';
            const [row] = await database.$queryRawUnsafe(
              `SELECT to_jsonb(t)::text AS data FROM public."${table}" t WHERE ${filter}=$1::uuid LIMIT 1`,
              owner.organizationId,
            );
            // Empty targets are harness failures, never a security PASS.
            assert.ok(row, `Missing indirect target ${table}`);
            const target = JSON.parse(row.data);
            const keys = model.fields.filter((f) => f.isId).map((f) => f.dbName ?? f.name);
            if (!keys.length)
              for (const field of model.primaryKey.fields)
                keys.push(model.fields.find((f) => f.name === field).dbName ?? field);
            const query = keys.map((key) => `${key}=eq.${target[key]}`).join('&');
            const payload =
              table === 'organizations'
                ? { settings: { ...target.settings, expenseApprovalRequired: false } }
                : { [keys[0]]: target[keys[0]] };
            const before = await snapshot();
            state('before', before);
            const response = await fetch(
              `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${query}`,
              {
                method: 'PATCH',
                headers: {
                  apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
                  Authorization: `Bearer ${person.token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
              },
            );
            const body = await response.json();
            state('attempt', {
              http: response.status,
              code: body.code,
              message: body.message,
              payload,
              target,
            });
            const after = await snapshot();
            state('after', after);
            assert.deepEqual(after, before);
            assert.equal(denialKind(response.status, body), 'PRIVILEGE_DENIED');
          },
        );
      }
    await check(
      `RLS-READ-${role}`,
      'Authorized own payment and cross-organization isolation',
      async () => {
        const target = fixtures.get('payments').target;
        const headers = {
          apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          ...(person ? { Authorization: `Bearer ${person.token}` } : {}),
        };
        const own = await fetch(
          `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/payments?id=eq.${target.id}&select=id`,
          { headers },
        );
        const body = await own.json();
        state('ownRead', { http: own.status, body });
        if (!person) {
          assert.equal(body.code, '42501');
          return;
        }
        assert.equal(own.status, 200);
        assert.equal(body.length, ['administrator', 'finance', 'client'].includes(role) ? 1 : 0);
        const other = await database.payment.findFirst({
          where: { organizationId: organizations[1] },
        });
        assert.ok(other, 'Cross-organization payment must exist');
        const cross = await fetch(
          `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/payments?id=eq.${other.id}&select=id`,
          { headers },
        );
        const crossBody = await cross.json();
        state('crossRead', { http: cross.status, body: crossBody });
        assert.equal(cross.status, 200);
        assert.deepEqual(crossBody, []);
      },
    );
    for (const table of financialTables)
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        await check(
          `RLS-WRITE-${role}-${table}-${method}`,
          'Valid payload, existing target, authorization boundary',
          async () => {
            const { target, insert } = fixtures.get(table);
            const [existing] = await database.$queryRawUnsafe(
              `SELECT id FROM public."${table}" WHERE id=$1::uuid`,
              target.id,
            );
            assert.equal(existing.id, target.id);
            const before = await snapshot();
            state('before', before);
            const response = await fetch(
              `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}${method === 'POST' ? '' : `?id=eq.${target.id}`}`,
              {
                method,
                signal: AbortSignal.timeout(15000),
                headers: {
                  apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
                  ...(person ? { Authorization: `Bearer ${person.token}` } : {}),
                  'Content-Type': 'application/json',
                  Prefer: 'return=representation',
                },
                ...(method === 'DELETE'
                  ? {}
                  : { body: JSON.stringify(method === 'POST' ? insert : updates[table]) }),
              },
            );
            const body = await response.json();
            const kind = denialKind(response.status, body);
            state('targetBefore', target);
            state('attempt', {
              role,
              profileId: person?.profileId,
              organizationId: owner.organizationId,
              table,
              method,
              targetId: target.id,
              payload: method === 'POST' ? insert : method === 'PATCH' ? updates[table] : null,
              http: response.status,
              code: body.code,
              message: body.message,
              kind,
            });
            const after = await snapshot();
            state('after', after);
            assert.deepEqual(after, before, 'No table, history or indirect effect');
            assert.equal(
              kind,
              'PRIVILEGE_DENIED',
              'RLS/domain/invalid token/zero rows cannot masquerade as ACL denial',
            );
            assert.ok(response.status >= 400 && response.status < 500);
          },
        );
      }
  }
}
