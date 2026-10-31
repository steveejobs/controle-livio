import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@livio/db';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL ausente.');
const databaseHost = new URL(databaseUrl).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(databaseHost)) {
  throw new Error('A verificação exige o PostgreSQL descartável em loopback.');
}

const prisma = new PrismaClient();
const migrationPath = 'supabase/migrations/20261031120000_payment_receipts.sql';
const migration = await (await import('node:fs/promises')).readFile(migrationPath, 'utf8');
if (!/^\s*BEGIN\s*;/i.test(migration) || !/COMMIT\s*;\s*$/i.test(migration)) {
  throw new Error('A migration deve delimitar suas alterações com BEGIN/COMMIT.');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const [relation] = await prisma.$queryRaw`
    SELECT c.relrowsecurity AS row_security,
           c.relforcerowsecurity AS force_row_security,
           c.relowner::regrole::text AS table_owner,
           current_user::text AS api_role,
           role.rolsuper AS api_superuser,
           role.rolbypassrls AS api_bypass_rls
    FROM pg_class c
    JOIN pg_roles role ON role.rolname = current_user
    WHERE c.oid = 'public.payment_receipts'::regclass
  `;
  assert(relation, 'Tabela payment_receipts não encontrada.');
  assert(relation.row_security && relation.force_row_security, 'RLS/ FORCE RLS não estão ativos.');
  assert(
    relation.api_superuser || relation.api_bypass_rls,
    'A role da API não ignora RLS, mas a tabela não possui policies; acesso da API seria negado.',
  );

  const browserRoles = await prisma.$queryRaw`
    SELECT rolname, rolsuper, rolbypassrls
    FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
  `;
  assert(browserRoles.length === 2, 'Roles anon/authenticated não encontradas.');
  assert(
    browserRoles.every((role) => !role.rolsuper && !role.rolbypassrls),
    'Role de usuário final não pode ter superuser nem BYPASSRLS.',
  );
  const [policySummary] = await prisma.$queryRaw`
    SELECT count(*)::int AS policy_count
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payment_receipts'
  `;
  assert(
    policySummary.policy_count === 0,
    'A tabela deve permanecer API-only sem policies diretas.',
  );

  const columns = await prisma.$queryRaw`
    SELECT attname FROM pg_attribute
    WHERE attrelid = 'public.payment_receipts'::regclass AND attnum > 0 AND NOT attisdropped
  `;
  const columnNames = new Set(columns.map(({ attname }) => attname));
  for (const column of [
    'organization_id',
    'client_id',
    'document_id',
    'installment_id',
    'expense_id',
    'payment_id',
    'sha256',
    'status',
    'extracted_fields',
    'reconciliation',
    'review_history',
    'submitted_by_id',
    'reviewed_by_id',
  ])
    assert(columnNames.has(column), `Coluna esperada ausente: ${column}.`);

  const constraints = await prisma.$queryRaw`
    SELECT conname, contype FROM pg_constraint
    WHERE conrelid = 'public.payment_receipts'::regclass
  `;
  const constraintNames = new Set(constraints.map(({ conname }) => conname));
  for (const constraint of [
    'payment_receipts_target_check',
    'payment_receipts_status_check',
    'payment_receipts_hash_check',
    'payment_receipts_organization_hash_key',
    'payment_receipts_fields_check',
    'payment_receipts_reconciliation_check',
    'payment_receipts_history_check',
  ])
    assert(constraintNames.has(constraint), `Constraint esperada ausente: ${constraint}.`);
  assert(
    constraints.filter(({ contype }) => contype === 'f').length === 8,
    'Relações FK incompletas.',
  );

  const indexes = await prisma.$queryRaw`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'payment_receipts'
  `;
  const indexNames = new Set(indexes.map(({ indexname }) => indexname));
  for (const index of [
    'payment_receipts_organization_client_status_idx',
    'payment_receipts_organization_installment_status_idx',
    'payment_receipts_organization_expense_status_idx',
  ])
    assert(indexNames.has(index), `Índice esperado ausente: ${index}.`);
  const paymentIndexes = await prisma.$queryRaw`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'payments' AND indexdef ILIKE '%UNIQUE%'
  `;
  assert(
    paymentIndexes.some(({ indexdef }) =>
      indexdef.replaceAll('"', '').includes('(organization_id, external_id)'),
    ),
    'O banco não tem unicidade de identificador bancário por organização.',
  );

  const permissions = await prisma.$queryRaw`
    SELECT r.key, p.action
    FROM public.roles r
    JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.organization_id = r.organization_id
    JOIN public.permissions p ON p.id = rp.permission_id AND p.organization_id = r.organization_id
    WHERE p.resource = 'receipts'
  `;
  for (const action of ['view', 'create', 'approve']) {
    assert(
      permissions.some((row) => row.key === 'finance' && row.action === action),
      `Permissão financeira ausente: ${action}.`,
    );
  }
  assert(
    permissions.some((row) => row.key === 'client' && row.action === 'create'),
    'Cliente não pode enviar comprovante.',
  );
  assert(
    !permissions.some((row) => row.key === 'client' && row.action === 'approve'),
    'Cliente recebeu permissão de aprovação.',
  );

  // Force RLS is checked against an actual synthetic row; role denial can be caused
  // either by missing SQL grants or by default-deny RLS, never by BYPASSRLS.
  const orgA = '10000000-0000-4000-8000-000000000001';
  const clientA = '11000000-0000-4000-8000-000000000001';
  const submitter = 'a1000000-0000-4000-8000-000000000005';
  const syntheticTitle = `ci-receipt-rls-${randomUUID()}`;
  let policyProbeDenied = false;
  let rollbackProbeId;
  try {
    await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          organizationId: orgA,
          clientId: clientA,
          description: syntheticTitle,
          category: 'CI_SYNTHETIC',
          amount: '1.00',
          incurredAt: new Date('2026-10-01T00:00:00.000Z'),
        },
      });
      const document = await tx.document.create({
        data: {
          organizationId: orgA,
          clientId: clientA,
          title: syntheticTitle,
          category: 'PAYMENT_RECEIPT',
          status: 'ACTIVE',
          visibility: 'CLIENT',
          confidential: false,
          createdById: submitter,
        },
      });
      const receipt = await tx.paymentReceipt.create({
        data: {
          organizationId: orgA,
          clientId: clientA,
          documentId: document.id,
          expenseId: expense.id,
          sha256: randomUUID().replaceAll('-', '').padEnd(64, 'a'),
          submittedById: submitter,
          extractedFields: {},
          reconciliation: {},
          reviewHistory: [],
        },
      });
      rollbackProbeId = receipt.id;
      for (const role of ['anon', 'authenticated']) {
        await tx.$executeRawUnsafe('SAVEPOINT payment_receipt_role_probe');
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        try {
          const visible = await tx.$queryRaw`
            SELECT id FROM public.payment_receipts WHERE id = ${receipt.id}::uuid
          `;
          assert(visible.length === 0, `Role ${role} conseguiu ler comprovante sem policy.`);
          await tx.$executeRawUnsafe('RESET ROLE');
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT payment_receipt_role_probe');
          await tx.$executeRawUnsafe('RESET ROLE');
          if (
            error?.code !== '42501' &&
            error?.meta?.code !== '42501' &&
            !String(error?.message).includes('permission denied')
          )
            throw error;
        }
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT payment_receipt_role_probe');
        policyProbeDenied = true;
      }
      // Deliberate failure proves receipt, document and target writes roll back together.
      throw new Error('CI_EXPECTED_ROLLBACK');
    });
  } catch (error) {
    if (error?.message !== 'CI_EXPECTED_ROLLBACK') throw error;
  }
  assert(policyProbeDenied, 'A negação por role final não foi verificada.');
  const [rolledBack] = await prisma.$queryRaw`
    SELECT count(*)::int AS count FROM public.payment_receipts WHERE id = ${rollbackProbeId}::uuid
  `;
  assert(rolledBack.count === 0, 'Dados do ensaio de rollback permaneceram no banco.');

  // The payment table's composite unique index is the concurrency gate. Competing
  // inserts with the same scoped key must yield one winner; another organization
  // and payments without an identifier remain valid.
  const prefix = `CI-RECEIPT-${randomUUID()}`;
  const paymentRefs = [];
  const makePayment = (organizationId, clientId, reference, externalId) => ({
    organizationId,
    clientId,
    reference,
    amount: '0.01',
    currency: 'BRL',
    paidAt: new Date('2026-10-30T12:00:00.000Z'),
    method: 'CI_SYNTHETIC',
    externalId,
    idempotencyKey: `${reference}-KEY`,
    idempotencyHash: randomUUID().replaceAll('-', '').padEnd(64, 'b'),
  });
  try {
    const externalId = `livio-receipt:v1:TRANSFER_TRANSACTION:${randomUUID().replaceAll('-', '')}`;
    const refs = [`${prefix}-A1`, `${prefix}-A2`];
    paymentRefs.push(...refs);
    const competing = await Promise.allSettled(
      refs.map((reference) =>
        prisma.payment.create({
          data: makePayment(orgA, clientA, reference, externalId),
          select: { id: true },
        }),
      ),
    );
    assert(
      competing.filter((result) => result.status === 'fulfilled').length === 1,
      'A corrida criou mais de um pagamento com o mesmo identificador.',
    );
    assert(
      competing.some((result) => result.status === 'rejected' && result.reason?.code === 'P2002'),
      'A duplicidade concorrente não foi rejeitada pelo índice único do PostgreSQL.',
    );

    const otherOrgRef = `${prefix}-B1`;
    paymentRefs.push(otherOrgRef);
    await prisma.payment.create({
      data: makePayment(
        '20000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        otherOrgRef,
        externalId,
      ),
      select: { id: true },
    });

    const noIdRefs = [`${prefix}-N1`, `${prefix}-N2`];
    paymentRefs.push(...noIdRefs);
    await Promise.all(
      noIdRefs.map((reference) =>
        prisma.payment.create({
          data: makePayment(orgA, clientA, reference, null),
          select: { id: true },
        }),
      ),
    );
  } finally {
    await prisma.payment.deleteMany({ where: { reference: { in: paymentRefs } } });
  }

  const report = {
    result: 'PASS',
    migration: '20261031120000_payment_receipts.sql',
    rls: 'FORCE_RLS; authenticated/anon denied; no direct policies',
    apiRole: relation.api_role,
    tableOwner: relation.table_owner,
    apiRoleIsTableOwner: relation.api_role === relation.table_owner,
    apiRoleBypassesRls: Boolean(relation.api_superuser || relation.api_bypass_rls),
    paymentIdentifierUniquePerOrganization: true,
    sameIdentifierAllowedAcrossOrganizations: true,
    absentIdentifiersAllowed: true,
    syntheticReceiptTransactionRollback: 'PASS',
    migrationFailureRollback:
      'NOT_FAULT_INJECTED; migration uses BEGIN/COMMIT and is applied by disposable db reset',
  };
  console.log(JSON.stringify(report));
  if (process.env.RUNNER_TEMP) {
    const evidenceDirectory = join(process.env.RUNNER_TEMP, 'livio-integrated-artifacts');
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(
      join(evidenceDirectory, 'receipt-migration-validation.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
  }
} finally {
  await prisma.$disconnect();
}
