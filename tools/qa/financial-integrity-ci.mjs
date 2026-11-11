import { runWriteMatrix } from './financial-write-matrix.mjs';
import { inspectFinancialSecurity } from './financial-security-ci.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateFinancialEnvironment,
  paymentPayload,
  expensePayload,
  reusableActors,
} from './financial-integrity-support.mjs';

// Runs only as a child of the existing disposable integration job. Never loads dotenv.
export async function runFinancialIntegrity(env = process.env) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  validateFinancialEnvironment(env, root);
  const require = createRequire(resolve(root, 'package.json'));
  const { PrismaClient, Prisma } = require('@prisma/client');
  const { createClient } = require('@supabase/supabase-js');
  const { PDFDocument } = require('pdf-lib');
  const { FinanceService } = require(resolve(root, 'apps/api/dist/finance/finance.service.js'));
  const { AuditService } = require(resolve(root, 'apps/api/dist/common/audit.service.js'));
  const database = new PrismaClient();
  const auth = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const output = resolve(env.LIVIO_QA_OUTPUT, 'workflow-stages/financial-stage3.json');
  if (existsSync(output))
    throw new Error('Previous financial evidence exists; use a new disposable evidence directory.');
  const evidence = {
    schema: 1,
    scope: 'real disposable PostgreSQL/Auth/API/Storage/ClamAV; injected faults explicitly labeled',
    baseSha: env.LIVIO_AUDIT_SHA ?? env.GITHUB_SHA ?? 'local-unpublished',
    cases: [],
  };
  let trace;
  const save = () => {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(evidence, null, 2));
  };
  const state = (name, value) => {
    trace[name] = JSON.parse(JSON.stringify(value));
    save();
  };
  const D = (value) => new Prisma.Decimal(value);
  const sum = (values) => values.reduce((total, value) => total.plus(value), D(0));
  let organizations;

  async function api(
    actor,
    path,
    { method = 'GET', body, key, organizationId = actor.organizationId, discard = false } = {},
  ) {
    const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
      method,
      signal: AbortSignal.timeout(35_000),
      headers: {
        Authorization: `Bearer ${actor.token}`,
        'X-Organization-Id': organizationId,
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    });
    if (discard) {
      await response.body?.cancel();
      trace.requests.push({
        actor: actor.userId,
        organizationId,
        method,
        path,
        status: response.status,
        responseBodyDiscarded: true,
      });
      return { status: response.status };
    }
    const text = await response.text();
    const json =
      response.headers.get('content-type')?.includes('json') && text ? JSON.parse(text) : text;
    trace.requests.push({
      actor: actor.userId,
      organizationId,
      method,
      path,
      status: response.status,
      ...(response.status >= 400 ? { domainCode: json.code, message: json.message } : {}),
    });
    save();
    return { status: response.status, body: json };
  }
  const status = (response, expected) => {
    assert.equal(response.status, expected);
    return response.body;
  };
  async function makeOrganization(label) {
    const organization = await database.organization.create({
      data: {
        legalName: `Auditoria sintética ${label}`,
        slug: `audit-stage3-${randomUUID()}`,
        status: 'ACTIVE',
        settings: { expenseApprovalRequired: true },
        timezone: 'America/Sao_Paulo',
      },
    });
    const roles = await database.role.findMany({
      where: { organizationId: '10000000-0000-4000-8000-000000000001' },
      include: { permissions: { include: { permission: true } } },
    });
    assert.equal(roles.length, 5);
    const permissions = new Map();
    for (const role of roles) {
      const copied = await database.role.create({
        data: { organizationId: organization.id, key: role.key, name: role.name, isSystem: true },
      });
      for (const { permission } of role.permissions) {
        const code = `${permission.resource}:${permission.action}`;
        if (!permissions.has(code))
          permissions.set(
            code,
            await database.permission.create({
              data: {
                organizationId: organization.id,
                resource: permission.resource,
                action: permission.action,
              },
            }),
          );
        await database.rolePermission.create({
          data: {
            organizationId: organization.id,
            roleId: copied.id,
            permissionId: permissions.get(code).id,
          },
        });
      }
    }
    return organization.id;
  }
  async function createActor(organizationId, roleKey = 'administrator', clientId) {
    const email = `stage3-${randomUUID()}@example.test`;
    const password = `LocalOnly-${randomUUID()}!`;
    const result = await auth.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(result.error, null);
    const profileId = result.data.user.id;
    await database.profile.upsert({
      where: { id: profileId },
      create: { id: profileId, email, fullName: 'QA financeiro sintético' },
      update: {},
    });
    const user = await database.user.create({
      data: {
        organizationId,
        authUserId: profileId,
        email,
        fullName: 'QA financeiro sintético',
        status: 'ACTIVE',
        ...(clientId ? { clientId } : {}),
      },
    });
    const role = await database.role.findUniqueOrThrow({
      where: { organizationId_key: { organizationId, key: roleKey } },
    });
    const membership = await database.organizationMember.create({
      data: {
        organizationId,
        profileId,
        userId: user.id,
        status: 'ACTIVE',
        ...(clientId ? { clientId } : {}),
        roles: { create: { organizationId, roleId: role.id } },
      },
    });
    const local = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await local.auth.signInWithPassword({ email, password });
    assert.equal(login.error, null);
    return {
      organizationId,
      userId: user.id,
      membershipId: membership.id,
      token: login.data.session.access_token,
      profileId,
      clientId,
      roleKey,
      isAdministrator: roleKey === 'administrator',
      permissions: [],
    };
  }
  const actor = reusableActors(createActor);
  async function fixture(owner, amount = '100.00', year = '2035') {
    const client = await database.client.create({
      data: {
        organizationId: owner.organizationId,
        type: 'PERSON',
        displayName: `Cliente sintético ${randomUUID()}`,
      },
    });
    const receivable = status(
      await api(owner, '/finance/receivables', {
        method: 'POST',
        body: {
          clientId: client.id,
          reference: `S3-${randomUUID()}`,
          description: 'Saldo sintético etapa 3',
          originalAmount: amount,
          currency: 'BRL',
          issueDate: `${year}-01-01`,
          installments: [{ sequence: 1, amount, dueDate: `${year}-01-31` }],
        },
      }),
      201,
    );
    return {
      organizationId: owner.organizationId,
      clientId: client.id,
      receivableId: receivable.id,
      installmentId: receivable.installments[0].id,
    };
  }
  async function ledger(f) {
    const payments = await database.payment.findMany({
      where: { organizationId: f.organizationId, clientId: f.clientId },
      orderBy: { id: 'asc' },
      include: { allocations: true },
    });
    const installment = await database.receivableInstallment.findUniqueOrThrow({
      where: { id: f.installmentId },
      include: { adjustments: true },
    });
    const allocations = payments.flatMap((p) =>
      p.allocations.filter(
        (a) => a.installmentId === f.installmentId && !a.reversedAt && p.status === 'CONFIRMED',
      ),
    );
    const adjusted = installment.adjustments
      .filter((a) => a.approvedAt)
      .reduce(
        (total, a) =>
          ['DISCOUNT', 'REVERSAL'].includes(a.kind) ? total.minus(a.amount) : total.plus(a.amount),
        installment.amount,
      );
    const audits = await database.auditLog.findMany({
      where: {
        organizationId: f.organizationId,
        resourceId: { in: [f.receivableId, f.installmentId, ...payments.map((p) => p.id)] },
      },
      orderBy: { id: 'asc' },
      select: { id: true, resource: true, resourceId: true, action: true, actorUserId: true },
    });
    return {
      fixture: f,
      balance: adjusted.minus(sum(allocations.map((a) => a.amount))).toFixed(4),
      receivableStatus: (
        await database.receivable.findUniqueOrThrow({ where: { id: f.receivableId } })
      ).status,
      installmentStatus: installment.status,
      payments: payments.map((p) => ({
        id: p.id,
        status: p.status,
        amount: p.amount.toFixed(4),
        idempotencyKey: p.idempotencyKey,
      })),
      allocations: allocations.map((a) => ({
        id: a.id,
        paymentId: a.paymentId,
        amount: a.amount.toFixed(4),
      })),
      reversals: await database.paymentReversal.findMany({
        where: {
          organizationId: f.organizationId,
          originalPaymentId: { in: payments.map((p) => p.id) },
        },
        orderBy: { id: 'asc' },
      }),
      changeRequests: await database.paymentChangeRequest.findMany({
        where: { organizationId: f.organizationId, paymentId: { in: payments.map((p) => p.id) } },
        select: { id: true, paymentId: true, status: true, createdById: true, reviewedById: true },
        orderBy: { id: 'asc' },
      }),
      audits,
    };
  }
  const pay = (owner, f, amount, key = `S3-${randomUUID()}`, options = {}) =>
    api(owner, '/finance/payments', {
      method: 'POST',
      key,
      body: paymentPayload(f, key, amount),
      ...options,
    });

  // The blocker is one transaction owned by this test. Both HTTP transactions must
  // actually wait on it (directly or transitively) before the barrier is released.
  async function overlap(table, ids, operations, whileBlocked) {
    assert.ok(['receivable_installments', 'payments', 'expenses'].includes(table));
    let release, ready;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const locked = new Promise((resolve) => {
      ready = resolve;
    });
    const holder = database.$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid()::int AS pid`;
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`,
        );
        ready(pid);
        await gate;
      },
      { timeout: 20_000 },
    );
    // Attach rejection immediately: a failed blocker cannot leave a promise hanging.
    const failed = holder.catch((error) => {
      ready(null);
      throw error;
    });
    const blockerPid = await locked;
    if (!blockerPid) {
      release();
      await failed;
      throw new Error('Blocker unavailable');
    }
    const pending = Promise.allSettled(operations.map((operation) => operation()));
    try {
      const deadline = Date.now() + 10_000;
      let blocked = 0;
      do {
        const rows = await database.$queryRaw`WITH RECURSIVE waiting(pid) AS (
          SELECT pid FROM pg_stat_activity WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
          UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid = ANY(pg_blocking_pids(a.pid))
        ) SELECT COUNT(DISTINCT pid)::int AS count FROM waiting`;
        blocked = rows[0].count;
        if (blocked >= operations.length) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      } while (Date.now() < deadline);
      state('overlap', {
        blockedTransactions: blocked,
        required: operations.length,
        barrier: table,
      });
      assert.ok(
        blocked >= operations.length,
        'Both transactions must overlap at the PostgreSQL lock',
      );
      await whileBlocked?.();
    } finally {
      release();
      try {
        await failed;
      } finally {
        await pending;
      }
    }
    return (await pending).map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
  }
  async function check(id, purpose, operation) {
    const previousTrace = trace;
    trace = { id, purpose, status: 'NOT_EXECUTED', requests: [] };
    evidence.cases.push(trace);
    save();
    try {
      await operation();
      trace.status = 'PASS';
    } catch (error) {
      trace.status = 'FAIL';
      trace.error = {
        type: error.name,
        code: error.code ?? null,
        ...(typeof error.actual === 'number' || typeof error.actual === 'string'
          ? { actual: error.actual }
          : {}),
        ...(typeof error.expected === 'number' || typeof error.expected === 'string'
          ? { expected: error.expected }
          : {}),
        location: String(error.stack ?? '')
          .split('\n')
          .find((line) => line.includes('financial-integrity-ci.mjs:'))
          ?.trim(),
      };
    }
    save();
    console.log(`${id}: ${trace.status}`);
    trace = previousTrace;
  }
  try {
    try {
      organizations = [await makeOrganization('A'), await makeOrganization('B')];
      evidence.setup = { status: 'PASS' };
    } catch (error) {
      evidence.setup = { status: 'FAIL', error: { type: error.name, code: error.code ?? null } };
      throw error;
    }
    evidence.organizations = organizations;
    for (const [id, amounts, expectedBalance, accepted] of [
      ['CEN-001', ['70.00', '70.00'], '30.0000', 1],
      ['CEN-002', ['70.00', '70.00'], '30.0000', 1],
      ['CEN-003', ['20.00', '30.00'], '50.0000', 2],
      ['CEN-004', ['60.00', '60.00'], '0.0000', 1],
    ])
      await check(id, 'Concurrent payment and ledger integrity', async () => {
        const a = await actor(organizations[0]),
          b = await actor(organizations[0]);
        const f = await fixture(a);
        if (id === 'CEN-004') status(await pay(a, f, '40.00'), 201);
        state('before', await ledger(f));
        const key = `S3-${randomUUID()}`;
        const results = await overlap(
          'receivable_installments',
          [f.installmentId],
          [
            () => pay(a, f, amounts[0], key),
            () => pay(b, f, amounts[1], id === 'CEN-001' ? key : `S3-${randomUUID()}`),
          ],
        );
        assert.ok(results.every((r) => [201, 400, 409].includes(r.status)));
        if (id !== 'CEN-001')
          assert.equal(results.filter((r) => r.status === 201).length, accepted);
        const after = await ledger(f);
        state('after', after);
        assert.equal(after.balance, expectedBalance);
        assert.equal(after.payments.length, accepted + (id === 'CEN-004' ? 1 : 0));
        assert.equal(after.allocations.length, after.payments.length);
        assert.equal(
          after.receivableStatus,
          expectedBalance === '0.0000' ? 'PAID' : 'PARTIALLY_PAID',
        );
        const repeat = await pay(a, f, amounts[0], key);
        assert.ok([201, 400, 409].includes(repeat.status));
        assert.deepEqual(await ledger(f), after);
      });
    await check('CEN-005', 'Client loses the response after commit, then retries', async () => {
      const a = await actor(organizations[0]),
        f = await fixture(a),
        key = `S3-${randomUUID()}`;
      state('before', await ledger(f));
      status(await pay(a, f, '33.34', key, { discard: true }), 201);
      const committed = await ledger(f);
      state('afterResponseLoss', committed);
      status(await pay(a, f, '33.34', key), 201);
      assert.deepEqual(await ledger(f), committed);
      assert.equal(committed.payments.length, 1);
      assert.equal(committed.balance, '66.6600');
      state('after', committed);
    });
    await check('CEN-006', 'Different receipts compete for one installment balance', async () => {
      const a = await actor(organizations[0]),
        b = await actor(organizations[0]),
        f = await fixture(a);
      const receipts = [];
      const paidAt = new Date(Date.now() - 86400000).toISOString().slice(0, 10) + 'T12:00:00Z';
      const dateText = new Date(paidAt).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
      for (const label of ['A', 'B']) {
        const pdf = await PDFDocument.create();
        const page = pdf.addPage();
        const lines = [
          `Comprovante PIX ${label} ${randomUUID()}`,
          'Valor pago: R$ 70,00',
          `Data do pagamento: ${dateText}`,
        ];
        lines.forEach((line, index) =>
          page.drawText(line, { x: 40, y: 780 - index * 24, size: 12 }),
        );
        const form = new FormData();
        form.set('installmentId', f.installmentId);
        form.set(
          'file',
          new Blob([await pdf.save()], { type: 'application/pdf' }),
          `synthetic-stage3-${label}.pdf`,
        );
        receipts.push(
          status(await api(a, '/finance/receipts', { method: 'POST', body: form }), 201),
        );
      }
      assert.equal(new Set(receipts.map((r) => r.id)).size, 2);
      assert.equal(new Set(receipts.map((r) => r.documentId)).size, 2);
      for (const receipt of receipts) {
        const row = await database.paymentReceipt.findUniqueOrThrow({ where: { id: receipt.id } });
        state(`extracted-${receipt.id}`, {
          id: row.id,
          documentId: row.documentId,
          fields: row.extractedFields,
        });
        assert.equal(row.extractedFields.paidAmount?.value, '70.00');
        assert.equal(row.extractedFields.paidDate?.value, paidAt.slice(0, 10));
      }
      state('before', await ledger(f));
      const results = await overlap(
        'receivable_installments',
        [f.installmentId],
        receipts.map(
          (r, index) => () =>
            api(index ? b : a, `/finance/receipts/${r.id}/confirm`, {
              method: 'POST',
              body: {
                amount: '70.00',
                paidAt,
                correctionReason:
                  'Revisao humana sintetica: valor e data conferidos no comprovante PIX.',
                method: 'PIX',
                reference: `S3-${r.id}`,
              },
            }),
        ),
      );
      assert.equal(results.filter((r) => r.status === 201).length, 1);
      assert.ok(results.every((r) => [201, 400, 409].includes(r.status)));
      const rows = await database.paymentReceipt.findMany({
        where: { id: { in: receipts.map((r) => r.id) }, organizationId: a.organizationId },
        orderBy: { id: 'asc' },
      });
      state(
        'receiptsAfter',
        rows.map((r) => ({
          id: r.id,
          documentId: r.documentId,
          status: r.status,
          paymentId: r.paymentId,
          reviewHistory: r.reviewHistory,
        })),
      );
      assert.equal(rows.filter((r) => r.status === 'CONFIRMED' && r.paymentId).length, 1);
      assert.equal(rows.filter((r) => r.status === 'PENDING_REVIEW' && !r.paymentId).length, 1);
      const after = await ledger(f);
      state('after', after);
      assert.equal(after.payments.length, 1);
      assert.equal(after.allocations.length, 1);
      assert.equal(after.balance, '30.0000');
      for (const [index, receipt] of receipts.entries()) {
        const repeated = await api(index ? b : a, `/finance/receipts/${receipt.id}/confirm`, {
          method: 'POST',
          body: {
            amount: '70.00',
            paidAt,
            correctionReason:
              'Revisao humana sintetica: valor e data conferidos no comprovante PIX.',
            method: 'PIX',
            reference: `S3-${receipt.id}`,
          },
        });
        assert.ok([201, 400, 409].includes(repeated.status));
      }
      assert.deepEqual(await ledger(f), after);
    });
    await check(
      'CEN-007',
      'Concurrent organizations with the same reference/idempotency key',
      async () => {
        const a = await actor(organizations[0]),
          b = await actor(organizations[1]);
        const fa = await fixture(a),
          fb = await fixture(b),
          key = `S3-${randomUUID()}`;
        state('before', [await ledger(fa), await ledger(fb)]);
        const results = await overlap(
          'receivable_installments',
          [fa.installmentId, fb.installmentId],
          [() => pay(a, fa, '25.00', key), () => pay(b, fb, '25.00', key)],
        );
        results.forEach((r) => status(r, 201));
        const rows = [await ledger(fa), await ledger(fb)];
        state('after', rows);
        rows.forEach((r) => {
          assert.equal(r.balance, '75.0000');
          assert.equal(r.payments.length, 1);
        });
        assert.notEqual(rows[0].payments[0].id, rows[1].payments[0].id);
        const denied = await api(a, `/finance/receivables/${fb.receivableId}`, {
          organizationId: b.organizationId,
        });
        status(denied, 401);
        assert.equal(denied.body.code, 'unauthorized');
        assert.ok(!JSON.stringify(denied.body).includes(fb.clientId));
        status(await pay(a, fa, '25.00', key), 201);
        status(await pay(b, fb, '25.00', key), 201);
        assert.deepEqual([await ledger(fa), await ledger(fb)], rows);
      },
    );

    // Further scenarios are defined below; none of these calls runs without the guard above.
    await runReversalsAndExpenses();
    await runRollbackAndReports();
    await check(
      'RLS-WRITE',
      'Direct authenticated writes must not bypass administrator reversal or expense approval',
      async () => {
        const admin = await actor(organizations[0]),
          finance = await actor(organizations[0], 'finance'),
          f = await fixture(admin);
        const payment = status(await pay(admin, f, '25.00'), 201).payment;
        const expense = status(
          await api(admin, '/finance/expenses', {
            method: 'POST',
            body: expensePayload(f.clientId),
          }),
          201,
        );
        const before = {
          ledger: await ledger(f),
          expense: await database.expense.findUniqueOrThrow({ where: { id: expense.id } }),
        };
        state('before', before);
        const rest = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
          auth: { persistSession: false },
          global: { headers: { Authorization: `Bearer ${finance.token}` } },
        });
        const changedPayment = await rest
          .from('payments')
          .update({ status: 'REVERSED' })
          .eq('id', payment.id)
          .select('id,status');
        const changedExpense = await rest
          .from('expenses')
          .update({ status: 'PAID', paid_at: '2035-01-15T12:00:00Z' })
          .eq('id', expense.id)
          .select('id,status');
        state('restResults', {
          payment: {
            status: changedPayment.status,
            code: changedPayment.error?.code ?? null,
            rows: changedPayment.data,
          },
          expense: {
            status: changedExpense.status,
            code: changedExpense.error?.code ?? null,
            rows: changedExpense.data,
          },
        });
        const after = {
          ledger: await ledger(f),
          expense: await database.expense.findUniqueOrThrow({ where: { id: expense.id } }),
        };
        state('after', after);
        assert.deepEqual(
          after,
          before,
          'RLS must not allow economic state changes outside the authorized domain flow',
        );
      },
    );
    await check(
      'API-CONTRACT-COMPATIBILITY',
      'Contract creation remains an authorized API transaction',
      async () => {
        const owner = await actor(organizations[0]);
        const f = await fixture(owner);
        const contract = status(
          await api(owner, '/finance/contracts', {
            method: 'POST',
            body: {
              clientId: f.clientId,
              number: randomUUID(),
              title: 'Synthetic contract',
              feeModel: 'FIXED',
              fixedAmount: '100.00',
            },
          }),
          201,
        );
        assert.equal(
          (await database.contract.findUniqueOrThrow({ where: { id: contract.id } })).clientId,
          f.clientId,
        );
        assert.equal(
          await database.auditLog.count({
            where: {
              organizationId: owner.organizationId,
              resourceId: contract.id,
              action: 'CREATE',
            },
          }),
          1,
        );
      },
    );
    await check('RLS-WRITE-MATRIX-SETUP', 'SQL inventory and valid fixtures', async () => {
      state(
        'catalog',
        await inspectFinancialSecurity(database, (value) => state('catalog', value)),
      );
      await runWriteMatrix({
        database,
        Prisma,
        env,
        actor,
        fixture,
        organizations,
        check,
        state,
        api,
      });
    });
    await check(
      'STORAGE-FINANCIAL-EVIDENCE',
      'Financial originals remain immutable through Storage client API',
      async () => {
        const owner = await actor(organizations[0]);
        const f = await fixture(owner);
        const pdf = await PDFDocument.create();
        pdf
          .addPage()
          .drawText('Synthetic financial evidence ' + randomUUID(), { x: 40, y: 780, size: 12 });
        const buffer = Buffer.from(await pdf.save());
        const form = new FormData();
        form.set('installmentId', f.installmentId);
        form.set('file', new Blob([buffer], { type: 'application/pdf' }), 'synthetic-evidence.pdf');
        const receipt = status(
          await api(owner, '/finance/receipts', { method: 'POST', body: form }),
          201,
        );
        const version = await database.documentVersion.findFirstOrThrow({
          where: { documentId: receipt.documentId },
        });
        const snapshot = async () => {
          const downloaded = await auth.storage
            .from('legal-documents')
            .download(version.storageKey);
          assert.equal(downloaded.error, null);
          const bytes = Buffer.from(await downloaded.data.arrayBuffer());
          return {
            sha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
            ledger: await ledger(f),
            receipt: await database.paymentReceipt.findUniqueOrThrow({ where: { id: receipt.id } }),
          };
        };
        for (const role of ['administrator', 'lawyer', 'secretary', 'finance', 'client']) {
          const person = await actor(
            organizations[0],
            role,
            role === 'client' ? f.clientId : undefined,
          );
          const rest = createClient(
            env.NEXT_PUBLIC_SUPABASE_URL,
            env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            {
              auth: { persistSession: false },
              global: { headers: { Authorization: `Bearer ${person.token}` } },
            },
          );
          const before = await snapshot();
          state(`before-${role}`, before);
          const update = await rest.storage
            .from('legal-documents')
            .update(version.storageKey, Buffer.from('Synthetic forbidden replacement'), {
              contentType: 'application/pdf',
            });
          assert.ok(update.error, 'Existing original must reject overwrite');
          const removal = await rest.storage.from('legal-documents').remove([version.storageKey]);
          // Storage may return success with an empty removal list under RLS.
          state(`attempt-${role}`, {
            update: { error: update.error?.message, status: update.error?.statusCode },
            remove: {
              error: removal.error?.message,
              status: removal.error?.statusCode,
              data: removal.data,
            },
          });
          const after = await snapshot();
          state(`after-${role}`, after);
          assert.deepEqual(after, before);
        }
      },
    );
    await check(
      'AUTH-REVOKED',
      'Revocation during a request: admission-time authorization is measured separately from subsequent requests',
      async () => {
        const a = await actor(organizations[0], 'administrator', undefined, true),
          f = await fixture(a);
        state('before', await ledger(f));
        const result = await overlap(
          'receivable_installments',
          [f.installmentId],
          [() => pay(a, f, '25.00')],
          async () => {
            await database.organizationMember.update({
              where: { id: a.membershipId },
              data: { status: 'SUSPENDED' },
            });
          },
        );
        status(result[0], 201);
        status(await api(a, `/finance/receivables/${f.receivableId}`), 401);
        state(
          'authorizationContract',
          'Request admitted before revocation can commit; new requests denied. No commit-time permission recheck is implemented.',
        );
        const after = await ledger(f);
        state('after', after);
        assert.equal(after.balance, '75.0000');
        assert.equal(after.payments.length, 1);
      },
    );
  } finally {
    await database.$disconnect();
    save();
  }
  assert.ok(
    evidence.cases.length > 0 && evidence.cases.every((c) => c.status === 'PASS'),
    'Financial integration has failing scenarios; inspect sanitized evidence.',
  );

  async function runReversalsAndExpenses() {
    await check(
      'REV-001',
      'Full reversal after settlement, invalid inputs, repeated/concurrent reversal',
      async () => {
        const a = await actor(organizations[0]),
          b = await actor(organizations[0]),
          f = await fixture(a);
        const payment = status(await pay(a, f, '100.00'), 201).payment;
        const paid = await ledger(f);
        state('before', paid);
        assert.equal(paid.balance, '0.0000');
        status(
          await api(a, `/finance/payments/${payment.id}/reversal`, {
            method: 'POST',
            body: { reason: 'x' },
          }),
          400,
        );
        assert.deepEqual(await ledger(f), paid);
        const results = await overlap(
          'payments',
          [payment.id],
          [a, b].map(
            (owner) => () =>
              api(owner, `/finance/payments/${payment.id}/reversal`, {
                method: 'POST',
                body: { reason: 'Estorno sintético integral' },
              }),
          ),
        );
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        const reversed = await ledger(f);
        state('after', reversed);
        assert.equal(reversed.balance, '100.0000');
        assert.equal(reversed.allocations.length, 0);
        assert.equal(reversed.payments[0].status, 'REVERSED');
        assert.equal(reversed.reversals.length, 1);
        assert.equal(reversed.audits.filter((e) => e.action === 'REVERSE').length, 1);
        status(
          await api(a, `/finance/payments/${payment.id}/reversal`, {
            method: 'POST',
            body: { reason: 'Retry sintético' },
          }),
          409,
        );
        assert.deepEqual(await ledger(f), reversed);
      },
    );
    await check(
      'COR-001',
      'Correction competes with payment and preserves immutable history',
      async () => {
        const a = await actor(organizations[0]),
          b = await actor(organizations[0]),
          f = await fixture(a);
        const payment = status(await pay(a, f, '40.00'), 201).payment;
        state('before', await ledger(f));
        const results = await overlap(
          'receivable_installments',
          [f.installmentId],
          [
            () =>
              api(a, `/finance/payments/${payment.id}/change-requests`, {
                method: 'PATCH',
                body: {
                  ...paymentPayload(f, `COR-${randomUUID()}`, '30.00'),
                  reason: 'Correção sintética',
                },
              }),
            () => pay(b, f, '70.00'),
          ],
        );
        status(results[0], 200);
        assert.ok([201, 400, 409].includes(results[1].status));
        const after = await ledger(f);
        state('after', after);
        assert.equal(after.balance, results[1].status === 201 ? '0.0000' : '70.0000');
        assert.equal(after.reversals.length, 1);
        assert.equal(after.payments.filter((p) => p.status === 'REVERSED').length, 1);
      },
    );
    for (const initialStatus of ['CANCELLED', 'WRITTEN_OFF', 'OPEN', 'PARTIALLY_PAID', 'OVERDUE']) {
      await check(
        `REN-STATE-${initialStatus}`,
        'Renegotiation state boundary and repetition',
        async () => {
          const owner = await actor(organizations[0]);
          const f = await fixture(owner);
          if (initialStatus === 'PARTIALLY_PAID') status(await pay(owner, f, '25.00'), 201);
          else
            await database.receivable.update({
              where: { id: f.receivableId },
              data: { status: initialStatus },
            });
          if (initialStatus === 'OVERDUE' || initialStatus === 'CANCELLED')
            await database.receivableInstallment.update({
              where: { id: f.installmentId },
              data: { status: initialStatus },
            });
          const snapshotRen = async () => {
            const debts = await database.receivable.findMany({
              where: { clientId: f.clientId },
              orderBy: { id: 'asc' },
              include: { installments: true },
            });
            const history = await database.renegotiation.findMany({
              where: { originalReceivableId: f.receivableId },
              orderBy: { id: 'asc' },
            });
            const ids = [
              ...debts.flatMap((d) => [d.id, ...d.installments.map((i) => i.id)]),
              ...history.map((r) => r.id),
            ];
            const audits = await database.auditLog.findMany({
              where: { organizationId: owner.organizationId, resourceId: { in: ids } },
              orderBy: { id: 'asc' },
            });
            return JSON.parse(JSON.stringify({ debts, history, audits, ledger: await ledger(f) }));
          };
          const before = await snapshotRen();
          state('before', before);
          const body = {
            reference: `REN-STATE-${randomUUID()}`,
            description: 'Renegociacao sintetica',
            reason: 'Condicao revisada em teste sintetico',
            issueDate: '2035-01-01',
            installments: [
              {
                sequence: 1,
                amount: initialStatus === 'PARTIALLY_PAID' ? '75.00' : '100.00',
                dueDate: '2035-02-01',
              },
            ],
          };
          const denied = ['CANCELLED', 'WRITTEN_OFF'].includes(initialStatus);
          const attempt = () =>
            api(owner, `/finance/receivables/${f.receivableId}/renegotiations`, {
              method: 'POST',
              body: { ...body, reference: `REN-${randomUUID()}` },
            });
          const results = denied
            ? await Promise.all([attempt(), attempt()])
            : await overlap('receivable_installments', [f.installmentId], [attempt, attempt]);
          state(
            'concurrentResponses',
            results.map((r) => r.status),
          );
          assert.deepEqual(results.map((r) => r.status).sort(), denied ? [409, 409] : [201, 409]);
          status(
            await api(owner, `/finance/receivables/${f.receivableId}/renegotiations`, {
              method: 'POST',
              body,
            }),
            409,
          );
          const after = await snapshotRen();
          state('after', after);
          if (denied) assert.deepEqual(after, before);
          else {
            assert.equal(after.history.length, 1);
            assert.equal(after.debts.filter((d) => d.status === 'OPEN').length, 1);
            assert.equal(after.history[0].status, 'APPROVED');
            assert.equal(
              after.audits.filter((a) => a.resource === 'renegotiation' && a.action === 'APPROVE')
                .length,
              1,
            );
          }
          const debts = await database.receivable.count({ where: { clientId: f.clientId } });
          assert.equal(debts, denied ? 1 : 2);
        },
      );
    }
    await check(
      'REN-001',
      'Renegotiation cannot duplicate a cancelled original (DEF-006)',
      async () => {
        const a = await actor(organizations[0]),
          b = await actor(organizations[0]),
          f = await fixture(a);
        state('before', await ledger(f));
        const input = (reference) => ({
          reference,
          description: 'Renegociação sintética',
          reason: 'Nova condição sintética',
          issueDate: '2035-01-01',
          installments: [{ sequence: 1, amount: '100.00', dueDate: '2035-02-01' }],
        });
        const results = await overlap(
          'receivable_installments',
          [f.installmentId],
          [a, b].map(
            (owner) => () =>
              api(owner, `/finance/receivables/${f.receivableId}/renegotiations`, {
                method: 'POST',
                body: input(`REN-${randomUUID()}`),
              }),
          ),
        );
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        status(
          await api(a, `/finance/receivables/${f.receivableId}/renegotiations`, {
            method: 'POST',
            body: input(`REN-${randomUUID()}`),
          }),
          409,
        );
        const debts = await database.receivable.findMany({
          where: { organizationId: a.organizationId, clientId: f.clientId },
        });
        assert.equal(debts.length, 2);
        assert.equal(debts.filter((d) => d.status === 'OPEN').length, 1);
        assert.equal(
          await database.renegotiation.count({
            where: { organizationId: a.organizationId, originalReceivableId: f.receivableId },
          }),
          1,
        );
        const finalLedger = await ledger(f);
        assert.equal(finalLedger.balance, '100.0000');
        assert.equal(finalLedger.payments.length, 0);
        state('after', {
          ledger: finalLedger,
          resultingReceivables: debts.map((d) => ({
            id: d.id,
            amount: d.originalAmount.toFixed(4),
            status: d.status,
          })),
        });
      },
    );
    for (const scenario of [
      'LIFECYCLE',
      'APPROVAL',
      'PAYMENT',
      'CANCEL_APPROVAL',
      'CANCEL_PAYMENT',
      'INVALID',
    ]) {
      await check(
        `EXP-${scenario}`,
        'Expense state machine, independent approval and competing transitions',
        async () => {
          const a = await actor(organizations[0]),
            b = await actor(organizations[0]),
            c = await actor(organizations[0]);
          const f = await fixture(a);
          const expense = status(
            await api(a, '/finance/expenses', { method: 'POST', body: expensePayload(f.clientId) }),
            201,
          );
          const path = `/finance/expenses/${expense.id}`;
          const read = async () => ({
            expense: await database.expense.findUniqueOrThrow({ where: { id: expense.id } }),
            audit: await database.auditLog.findMany({
              where: {
                organizationId: a.organizationId,
                resource: 'expense',
                resourceId: expense.id,
              },
              orderBy: { id: 'asc' },
            }),
          });
          const payment = {
            amount: '25.00',
            paidAt: '2035-01-15T12:00:00Z',
            method: 'PIX',
            reference: `EXP-${expense.id}`,
          };
          state('before', await read());
          if (scenario === 'LIFECYCLE') {
            status(
              await api(a, path, { method: 'PATCH', body: { description: 'Despesa revisada' } }),
              200,
            );
            status(await api(a, `${path}/submit`, { method: 'POST' }), 201);
            status(
              await api(b, `${path}/reject`, {
                method: 'POST',
                body: { reason: 'Correção necessária' },
              }),
              201,
            );
            status(await api(a, path, { method: 'PATCH', body: { amount: '25.00' } }), 200);
          }
          if (scenario === 'INVALID') {
            status(await api(a, `${path}/payment`, { method: 'POST', body: payment }), 409);
          }
          status(await api(a, `${path}/submit`, { method: 'POST' }), 201);
          if (scenario === 'APPROVAL') {
            const results = await overlap(
              'expenses',
              [expense.id],
              [b, c].map((owner) => () => api(owner, `${path}/approve`, { method: 'POST' })),
            );
            assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
          } else if (scenario === 'CANCEL_APPROVAL') {
            const results = await overlap(
              'expenses',
              [expense.id],
              [
                () => api(a, `${path}/cancel`, { method: 'POST' }),
                () => api(b, `${path}/approve`, { method: 'POST' }),
              ],
            );
            status(results[0], 201);
            assert.ok([201, 409].includes(results[1].status));
          } else {
            status(await api(a, `${path}/approve`, { method: 'POST' }), 403);
            status(await api(b, `${path}/approve`, { method: 'POST' }), 201);
            if (scenario === 'PAYMENT' || scenario === 'CANCEL_PAYMENT') {
              const results = await overlap(
                'expenses',
                [expense.id],
                [
                  () => api(a, `${path}/payment`, { method: 'POST', body: payment }),
                  () =>
                    api(b, `${path}/${scenario === 'PAYMENT' ? 'payment' : 'cancel'}`, {
                      method: 'POST',
                      ...(scenario === 'PAYMENT' ? { body: payment } : {}),
                    }),
                ],
              );
              assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
            } else if (scenario === 'INVALID') {
              const before = await read();
              status(
                await api(a, `${path}/payment`, {
                  method: 'POST',
                  body: { ...payment, amount: '24.99' },
                }),
                400,
              );
              status(await api(a, path, { method: 'PATCH', body: { amount: '30.00' } }), 409);
              assert.deepEqual(await read(), before);
            } else status(await api(a, `${path}/payment`, { method: 'POST', body: payment }), 201);
          }
          const after = await read();
          state('after', after);
          const payEvents = after.audit.filter((e) => e.metadata?.transition === 'PAY');
          assert.equal(payEvents.length, after.expense.status === 'PAID' ? 1 : 0);
          if (scenario === 'APPROVAL' || scenario === 'INVALID')
            assert.equal(after.expense.status, 'APPROVED');
          if (scenario === 'CANCEL_APPROVAL') assert.equal(after.expense.status, 'CANCELLED');
          if (scenario === 'LIFECYCLE' || scenario === 'PAYMENT')
            assert.equal(after.expense.status, 'PAID');
          if (after.expense.status === 'PAID') {
            status(await api(a, `${path}/payment`, { method: 'POST', body: payment }), 409);
            status(await api(a, `${path}/cancel`, { method: 'POST' }), 409);
            assert.deepEqual(await read(), after);
          }
        },
      );
    }
  }

  async function runRollbackAndReports() {
    for (const point of ['payment', 'allocation-constraint', 'installment', 'audit', 'connection'])
      await check(
        `ROLLBACK-${point}`,
        'Real transaction with explicit service-layer fault injection (not HTTP)',
        async () => {
          const owner = await actor(organizations[0]),
            f = await fixture(owner);
          const before = await ledger(f);
          state('before', before);
          let injected = false;
          const broken = new Proxy(database, {
            get(target, key) {
              if (key !== '$transaction') {
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
              }
              return (operation, options) =>
                target.$transaction(
                  async (tx) =>
                    operation(
                      new Proxy(tx, {
                        get(inner, model) {
                          if (
                            ['payment', 'allocation-constraint', 'connection'].includes(point) &&
                            model === 'payment'
                          )
                            return new Proxy(inner.payment, {
                              get(table, method) {
                                if (method !== 'create')
                                  return table[method]?.bind?.(table) ?? table[method];
                                return async (args) => {
                                  if (point === 'allocation-constraint') {
                                    injected = true;
                                    return table.create({
                                      ...args,
                                      data: {
                                        ...args.data,
                                        allocations: {
                                          create: args.data.allocations.create.map(
                                            (allocation) => ({ ...allocation, amount: D('101') }),
                                          ),
                                        },
                                      },
                                    });
                                  }
                                  await table.create(args);
                                  injected = true;
                                  if (point === 'connection') {
                                    const [{ pid }] =
                                      await inner.$queryRaw`SELECT pg_backend_pid()::int AS pid`;
                                    await database.$queryRaw`SELECT pg_terminate_backend(${pid})`;
                                  }
                                  throw new Error('Injected financial transaction failure');
                                };
                              },
                            });
                          if (point === 'installment' && model === 'receivableInstallment')
                            return new Proxy(inner.receivableInstallment, {
                              get(table, method) {
                                if (method !== 'update')
                                  return table[method]?.bind?.(table) ?? table[method];
                                return async (args) => {
                                  await table.update(args);
                                  injected = true;
                                  throw new Error('Injected installment failure');
                                };
                              },
                            });
                          const value = Reflect.get(inner, model);
                          return typeof value === 'function' ? value.bind(inner) : value;
                        },
                      }),
                    ),
                  options,
                );
            },
          });
          const audit = new AuditService();
          const injectedAudit = {
            record: async (tx, input) => {
              const result = await audit.record(tx, input);
              if (point === 'audit') {
                injected = true;
                throw new Error('Injected audit failure');
              }
              return result;
            },
          };
          const service = new FinanceService(broken, injectedAudit);
          await assert.rejects(
            service.createPayment(owner, `FAULT-${randomUUID()}`, {
              ...paymentPayload(f, `FAULT-${randomUUID()}`, '25.00'),
              paidAt: new Date('2035-01-15T12:00:00Z'),
            }),
            (error) =>
              point !== 'allocation-constraint' ||
              String(error.message).includes('Allocation exceeds'),
          );
          assert.equal(injected, true);
          const after = await ledger(f);
          state('after', after);
          assert.deepEqual(after, before);
          status(await pay(owner, f, '25.00'), 201);
          const recovered = await ledger(f);
          state('recovery', recovered);
          assert.equal(recovered.balance, '75.0000');
          assert.equal(recovered.payments.length, 1);
        },
      );
    for (const operation of ['reversal', 'correction', 'expense'])
      await check(
        `ROLLBACK-${operation}`,
        'Rollback of compensation or expense payment when the audit write fails',
        async () => {
          const owner = await actor(organizations[0]),
            reviewer = await actor(organizations[0]),
            f = await fixture(owner);
          let target;
          if (operation === 'expense') {
            target = status(
              await api(owner, '/finance/expenses', {
                method: 'POST',
                body: expensePayload(f.clientId),
              }),
              201,
            );
            status(
              await api(owner, `/finance/expenses/${target.id}/submit`, { method: 'POST' }),
              201,
            );
            status(
              await api(reviewer, `/finance/expenses/${target.id}/approve`, { method: 'POST' }),
              201,
            );
          } else target = status(await pay(owner, f, '40.00'), 201).payment;
          const snapshot = async () =>
            operation === 'expense'
              ? {
                  expense: await database.expense.findUniqueOrThrow({ where: { id: target.id } }),
                  audit: await database.auditLog.findMany({
                    where: {
                      organizationId: owner.organizationId,
                      resource: 'expense',
                      resourceId: target.id,
                    },
                    orderBy: { id: 'asc' },
                  }),
                }
              : await ledger(f);
          const before = await snapshot();
          state('before', before);
          let injected = false;
          const audit = new AuditService();
          const service = new FinanceService(database, {
            record: async (tx, input) => {
              await audit.record(tx, input);
              injected = true;
              throw new Error('Injected post-write audit failure');
            },
          });
          const promise =
            operation === 'expense'
              ? service.payExpense(owner, target.id, {
                  amount: '25.00',
                  paidAt: new Date('2035-01-15'),
                  method: 'PIX',
                })
              : operation === 'reversal'
                ? service.reversePayment(owner, target.id, {
                    reason: 'Estorno sintético com falha',
                  })
                : service.requestPaymentChange(owner, target.id, {
                    ...paymentPayload(f, `COR-${randomUUID()}`, '30.00'),
                    paidAt: new Date('2035-01-15'),
                    reason: 'Correção sintética com falha',
                  });
          await assert.rejects(promise);
          assert.equal(injected, true);
          const after = await snapshot();
          state('after', after);
          assert.deepEqual(after, before);
        },
      );
    for (const fault of ['document', 'receipt', 'provider-error', 'provider-unavailable'])
      await check(
        `ROLLBACK-UPLOAD-${fault}`,
        'Real scanner/Storage/Prisma compensation with a failed record write (service injection)',
        async () => {
          const { DocumentsService } = require(
            resolve(root, 'apps/api/dist/documents/documents.service.js'),
          );
          const { StorageService } = require(
            resolve(root, 'apps/api/dist/documents/storage.service.js'),
          );
          const { DocumentScannerService } = require(
            resolve(root, 'apps/api/dist/documents/document-scanner.service.js'),
          );
          const { ReceiptService } = require(
            resolve(root, 'apps/api/dist/finance/receipt.service.js'),
          );
          const { ReceiptExtractionService } = require(
            resolve(root, 'apps/api/dist/finance/receipt-extraction.service.js'),
          );
          const point = fault.startsWith('provider-') ? 'document' : fault;
          const owner = await actor(organizations[0]),
            f = await fixture(owner);
          owner.permissions = status(await api(owner, '/auth/me'), 200).user.permissions;
          const config = {
            get: (name) =>
              ({
                SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
                SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
                SUPABASE_ENVIRONMENT: 'staging',
                SUPABASE_LOCAL: true,
                STORAGE_BUCKET: 'legal-documents',
                MAX_DOCUMENT_SIZE_MB: 4,
                CLAMAV_HOST: '127.0.0.1',
                CLAMAV_PORT: 13310,
                CLAMAV_TIMEOUT_MS: 10000,
              })[name],
          };
          const storage = new StorageService(config),
            scanner = new DocumentScannerService(config),
            audit = new AuditService();
          let providerAttempted = false;
          if (fault.startsWith('provider-')) {
            const provider = storage.client;
            storage.client = {
              storage: {
                from: (bucket) => {
                  const original = provider.storage.from(bucket);
                  return new Proxy(original, {
                    get(target, key) {
                      if (key === 'remove')
                        return async () => {
                          providerAttempted = true;
                          if (fault === 'provider-unavailable')
                            throw new Error('Injected provider unavailable during compensation');
                          return {
                            data: null,
                            error: { message: 'Injected provider remove failure' },
                          };
                        };
                      const value = Reflect.get(target, key);
                      return typeof value === 'function' ? value.bind(target) : value;
                    },
                  });
                },
              },
            };
          }
          let injected = false;
          const broken = new Proxy(database, {
            get(target, key) {
              if (key !== '$transaction') {
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
              }
              return (operation, options) =>
                target.$transaction(
                  async (tx) =>
                    operation(
                      new Proxy(tx, {
                        get(inner, model) {
                          if (model === (point === 'document' ? 'document' : 'paymentReceipt'))
                            return new Proxy(inner[model], {
                              get(table, method) {
                                if (method !== 'create')
                                  return table[method]?.bind?.(table) ?? table[method];
                                return async (args) => {
                                  await table.create(args);
                                  injected = true;
                                  throw new Error('Injected upload record failure');
                                };
                              },
                            });
                          const value = Reflect.get(inner, model);
                          return typeof value === 'function' ? value.bind(inner) : value;
                        },
                      }),
                    ),
                  options,
                );
            },
          });
          const docs = new DocumentsService(
            point === 'document' ? broken : database,
            storage,
            audit,
            config,
            undefined,
            undefined,
            scanner,
          );
          const receipts = new ReceiptService(
            point === 'receipt' ? broken : database,
            new FinanceService(database, audit),
            docs,
            scanner,
            new ReceiptExtractionService(),
            storage,
            audit,
          );
          const inventory = async () =>
            database.$queryRaw`SELECT name FROM storage.objects WHERE bucket_id = 'legal-documents' AND name LIKE ${`organizations/${owner.organizationId}/documents/%`} ORDER BY name`;
          const before = await inventory();
          state('before', { storage: before, ledger: await ledger(f) });
          const pdf = await PDFDocument.create();
          pdf
            .addPage()
            .drawText(`PIX ${randomUUID()}\nValor pago: R$ 25,00\nData do pagamento: 15/01/2035`);
          const buffer = Buffer.from(await pdf.save());
          await assert.rejects(
            receipts.submit(
              owner,
              { installmentId: f.installmentId },
              {
                buffer,
                size: buffer.length,
                mimetype: 'application/pdf',
                originalname: 'synthetic-fault.pdf',
              },
            ),
            (error) => {
              state('communicatedError', {
                type: error.name,
                message: error.message,
                status: error.getStatus?.(),
              });
              return fault === 'provider-error'
                ? error.getStatus?.() === 503
                : fault === 'provider-unavailable'
                  ? error.message === 'Injected provider unavailable during compensation'
                  : error.message === 'Injected upload record failure';
            },
          );
          assert.equal(injected, true);
          const afterStorage = await inventory();
          if (fault.startsWith('provider-')) {
            assert.equal(providerAttempted, true);
            assert.ok(
              afterStorage.length > before.length,
              'Failed compensation leaves a measurable synthetic orphan',
            );
            state('orphanRisk', {
              fault,
              reconciliation: 'MANUAL_REQUIRED',
              objects: afterStorage.filter((row) => !before.some((old) => old.name === row.name)),
            });
          } else assert.deepEqual(afterStorage, before);
          assert.equal(
            await database.paymentReceipt.count({ where: { installmentId: f.installmentId } }),
            0,
          );
          assert.equal(
            await database.document.count({
              where: {
                organizationId: owner.organizationId,
                clientId: f.clientId,
                deletedAt: null,
              },
            }),
            0,
          );
          state('after', {
            storage: await inventory(),
            ledger: await ledger(f),
            tombstones: await database.document.count({
              where: { clientId: f.clientId, deletedAt: { not: null } },
            }),
          });
        },
      );
    await check(
      'REPORT-001',
      'Known ledger totals, reversal exclusion, expenses and CSV contents',
      async () => {
        const a = await actor(organizations[0]),
          b = await actor(organizations[0]),
          f = await fixture(a, '100.0000', '2040');
        const paidAt = '2040-01-15T12:00:00Z';
        const key = `REPORT-${randomUUID()}`;
        const reversed = status(
          await pay(a, f, '20.00', key, { body: paymentPayload(f, key, '20.00', paidAt) }),
          201,
        ).payment;
        status(
          await api(a, `/finance/payments/${reversed.id}/reversal`, {
            method: 'POST',
            body: { reason: 'Excluir do caixa sintético' },
          }),
          201,
        );
        const next = `REPORT-${randomUUID()}`;
        status(
          await pay(a, f, '77.7777', next, { body: paymentPayload(f, next, '77.7777', paidAt) }),
          201,
        );
        for (const [amount, paid] of [
          ['12.1111', true],
          ['20.0000', false],
        ]) {
          const expense = status(
            await api(a, '/finance/expenses', {
              method: 'POST',
              body: expensePayload(f.clientId, amount, paidAt),
            }),
            201,
          );
          status(await api(a, `/finance/expenses/${expense.id}/submit`, { method: 'POST' }), 201);
          status(await api(b, `/finance/expenses/${expense.id}/approve`, { method: 'POST' }), 201);
          if (paid)
            status(
              await api(a, `/finance/expenses/${expense.id}/payment`, {
                method: 'POST',
                body: { amount, paidAt, method: 'PIX' },
              }),
              201,
            );
        }
        const query = 'from=2040-01-01T00:00:00Z&to=2040-02-01T00:00:00Z&groupBy=month';
        const flow = status(await api(a, `/reports/cash-flow?${query}`), 200);
        const row = flow.rows.find((row) => row.currency === 'BRL');
        assert.equal(row.received_amount, '77.7777');
        assert.equal(row.paid_expenses, '12.1111');
        assert.equal(row.net_cash, '65.6666');
        assert.equal(row.expected_receivables, '22.2223');
        assert.equal(row.expected_expenses, '20.0000');
        const perClient = status(
          await api(a, `/reports/cash-flow-by-client?${query}`),
          200,
        ).rows.find((row) => row.client_id === f.clientId);
        assert.equal(perClient.received_amount, '77.7777');
        assert.equal(perClient.net_cash, '65.6666');
        const csv = status(await api(a, `/reports/cash-flow/export.csv?${query}`), 200);
        assert.ok(csv.includes('"77.7777"') && csv.includes('"65.6666"'));
        state('after', { ledger: await ledger(f), flow, perClient, csv });
      },
    );
    await check(
      'AUTH-001',
      'Five roles, cross-organization IDs, suspended membership, invalid token and RLS',
      async () => {
        const admin = await actor(organizations[0]),
          other = await actor(organizations[1]);
        const f = await fixture(admin),
          foreign = await fixture(other);
        const payment = status(await pay(admin, f, '25.00'), 201).payment;
        const before = await ledger(f);
        state('before', before);
        const pdf = await PDFDocument.create();
        pdf
          .addPage()
          .drawText(
            `PIX privado ${randomUUID()}\nValor pago: R$ 25,00\nData do pagamento: 15/01/2035`,
          );
        const upload = new FormData();
        upload.set('installmentId', f.installmentId);
        upload.set(
          'file',
          new Blob([await pdf.save()], { type: 'application/pdf' }),
          'synthetic-private.pdf',
        );
        const privateReceipt = status(
          await api(admin, '/finance/receipts', { method: 'POST', body: upload }),
          201,
        );
        for (const roleKey of ['administrator', 'lawyer', 'secretary', 'finance', 'client']) {
          const person = await actor(
            organizations[0],
            roleKey,
            roleKey === 'client' ? f.clientId : undefined,
          );
          const me = status(await api(person, '/auth/me'), 200);
          state(`role-${roleKey}`, { userId: person.userId, permissions: me.user.permissions });
          const result = await api(person, `/finance/payments/${payment.id}/reversal`, {
            method: 'POST',
            body: { reason: 'Sem permissão sintética' },
          });
          if (roleKey === 'administrator') status(result, 201);
          else status(result, 403);
          const foreignRead = await api(person, `/finance/receivables/${foreign.receivableId}`);
          status(foreignRead, me.user.permissions.includes('receivables:view') ? 404 : 403);
          const permission = (code) => me.user.permissions.includes(code);
          status(await pay(person, f, '1.00'), permission('payments:create') ? 201 : 403);
          status(
            await api(person, '/reports/cash-flow?from=2035-01-01&to=2035-02-01&groupBy=month'),
            permission('reports:view') ? 200 : 403,
          );
          status(
            await api(
              person,
              '/reports/cash-flow/export.csv?from=2035-01-01&to=2035-02-01&groupBy=month',
            ),
            roleKey === 'administrator' ? 200 : 403,
          );
          const download = await api(
            person,
            `/documents/${privateReceipt.documentId}/download-url`,
          );
          status(download, permission('documents:view') ? (roleKey === 'client' ? 404 : 200) : 403);
          if (download.status === 200) {
            assert.ok(['127.0.0.1', 'localhost'].includes(new URL(download.body.url).hostname));
            const file = await fetch(download.body.url, { signal: AbortSignal.timeout(10000) });
            assert.equal(file.status, 200);
            await file.arrayBuffer();
          }
          const expense = status(
            await api(admin, '/finance/expenses', {
              method: 'POST',
              body: expensePayload(f.clientId),
            }),
            201,
          );
          status(
            await api(admin, `/finance/expenses/${expense.id}/submit`, { method: 'POST' }),
            201,
          );
          status(
            await api(person, `/finance/expenses/${expense.id}/approve`, { method: 'POST' }),
            permission('expenses:approve') ? 201 : 403,
          );
        }
        const suspended = await actor(organizations[0], 'administrator', undefined, true);
        await database.organizationMember.update({
          where: { id: suspended.membershipId },
          data: { status: 'SUSPENDED' },
        });
        const denied = await api(suspended, `/finance/receivables/${f.receivableId}`);
        status(denied, 401);
        assert.equal(denied.body.code, 'unauthorized');
        status(await api({ ...suspended, token: 'invalid-synthetic-token' }, '/auth/me'), 401);
        const ownAuth = createClient(
          env.NEXT_PUBLIC_SUPABASE_URL,
          env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          {
            auth: { persistSession: false },
            global: { headers: { Authorization: `Bearer ${admin.token}` } },
          },
        );
        const own = await ownAuth.from('payments').select('id').eq('id', payment.id);
        assert.equal(own.error, null);
        assert.equal(own.data.length, 1);
        const cross = await ownAuth.from('receivables').select('id').eq('id', foreign.receivableId);
        assert.equal(cross.error, null);
        assert.equal(cross.data.length, 0);
        state('after', {
          ledger: await ledger(f),
          rlsOwnRows: own.data.length,
          rlsForeignRows: cross.data.length,
        });
      },
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFinancialIntegrity().catch(() => {
    console.error(
      'Financial integration refused or failed; sanitized financial-stage3.json exists only after successful preflight.',
    );
    process.exitCode = 1;
  });
}
