import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const dir = 'docs/auditoria-2026-11-04';
const raw = readFileSync(`${dir}/INVENTARIO_FUNCIONAL_COMPLETO.json`, 'utf8');
const candidates = JSON.parse(raw.replace(/^\uFEFF/, ''));
if (candidates.length !== 213) throw Error('Preserve and review the source inventory.');
const ids = (...numbers) => numbers.map((n) => `SURF-${String(n).padStart(3, '0')}`);
const groups = [
  [
    'FIN-001',
    'Catálogo de serviços',
    ids(57, 58, 126, 127),
    'list/create',
    'contracts:view/create',
    'serviceCatalogItems/createServiceCatalogItem',
  ],
  [
    'FIN-002',
    'Contratos e vínculos',
    ids(37, 128, 151),
    'create/list/associate',
    'contracts:view/create',
    'createContract/listContracts',
  ],
  [
    'FIN-003',
    'Recebíveis e parcelas',
    ids(38, 129, 130, 152),
    'create/list/get',
    'receivables:view/create',
    'createReceivable/listReceivables/getReceivable',
  ],
  [
    'FIN-004',
    'Pagamento, alocação e idempotência',
    ids(39, 131, 153),
    'create/list/retry/allocate',
    'payments:view/create',
    'createPayment/listPayments',
  ],
  [
    'FIN-005',
    'Estorno integral',
    ids(50, 132),
    'reverse/repeat/concurrent',
    'payments:approve + administrator',
    'reversePayment',
  ],
  [
    'FIN-006',
    'Correção por solicitação',
    ids(51, 52, 133, 134, 135, 136),
    'request/list/approve/reject/replace',
    'payments:update; payments:approve + administrator',
    'requestPaymentChange/decidePaymentChange',
  ],
  [
    'FIN-007',
    'Ajustes aprovados',
    ids(49, 137),
    'discount/interest/penalty/correction/reversal/other',
    'receivables:approve',
    'addAdjustment',
  ],
  [
    'FIN-008',
    'Renegociação',
    ids(138),
    'renegotiate/repeat/concurrent',
    'receivables:approve',
    'renegotiate',
  ],
  [
    'FIN-009',
    'Ciclo de despesas',
    ids(40, 41, 42, 44, 45, 46, 139, 141, 143, 144, 146, 147, 148, 149, 154),
    'create/edit/submit/approve/reject/pay/cancel/list/responsibles',
    'expenses:view/create/update/approve',
    'createExpense/updateExpense/submitExpense/decideExpense/payExpense/cancelExpense/listExpenses/expenseResponsibles',
  ],
  [
    'FIN-010',
    'Política de aprovação',
    ids(47, 140, 142),
    'get/update',
    'expenses:view; organization:update + administrator',
    'expenseApprovalPolicy/updateExpenseApprovalPolicy',
  ],
  ['FIN-011', 'Histórico de despesas', ids(145), 'get/paginate', 'expenses:view', 'expenseHistory'],
  [
    'FIN-012',
    'Resumo de despesas',
    ids(150),
    'summary/period/currency',
    'expenses:view',
    'expenseSummary',
  ],
  [
    'FIN-013',
    'Comprovante e revisão',
    ids(54, 55, 56, 155, 156, 157, 158, 159),
    'submit/get/list/confirm/reject/requestCorrection',
    'receipts:create/view/approve plus linked domain permissions',
    'ReceiptService.submit/get/list/confirm/decide',
  ],
  [
    'FIN-014',
    'Documentos financeiros privados',
    ids(43, 48, 53),
    'upload/associate/download/compensate',
    'documents:create/view; receipt paths governed by receipts permissions',
    'DocumentsService.create/downloadUrl; StorageService.remove',
  ],
];
const scenarios = {
  'FIN-004': ['CEN-001', 'CEN-002', 'CEN-003', 'CEN-004', 'CEN-005', 'CEN-006', 'CEN-007'],
  'FIN-005': ['REV-001', 'ROLLBACK-reversal'],
  'FIN-006': ['COR-001', 'ROLLBACK-correction'],
  'FIN-008': ['REN-001'],
  'FIN-009': [
    'EXP-LIFECYCLE',
    'EXP-APPROVAL',
    'EXP-PAYMENT',
    'EXP-CANCEL_APPROVAL',
    'EXP-CANCEL_PAYMENT',
    'EXP-INVALID',
    'ROLLBACK-expense',
  ],
  'FIN-013': ['CEN-006', 'ROLLBACK-UPLOAD-receipt'],
  'FIN-014': ['ROLLBACK-UPLOAD-document', 'ROLLBACK-UPLOAD-receipt'],
};
const reports = [
  'receivables-due',
  'received',
  'accrual',
  'overdue',
  'aging',
  'cash-forecast',
  'cash-flow',
  'cash-flow-by-client',
  'partial-payments',
  'active-contracts',
  'revenue-by-lawyer',
  'revenue-by-service',
  'delinquent-clients',
  'reconciliation',
];
reports.forEach((name, index) =>
  groups.push([
    `REP-${String(index + 1).padStart(3, '0')}`,
    name,
    ids(186 + index, 200),
    'query/filter/exportCSV',
    'reports:view; reports:export + administrator',
    `ReportsService.run:${name}`,
  ]),
);
const features = groups.map(([id, name, candidateIds, operations, permissions, service]) => ({
  id,
  name,
  candidateIds,
  operations: operations.split('/'),
  permissions,
  service,
  status:
    id === 'FIN-007' ||
    (id.startsWith('REP') && !['received', 'cash-flow', 'cash-flow-by-client'].includes(name))
      ? 'NOT_EXECUTED'
      : 'PARTIAL',
  source: id.startsWith('REP')
    ? 'apps/api/src/reports/reports.service.ts'
    : 'apps/api/src/finance/finance.service.ts; receipt.service.ts; documents/storage.service.ts',
  interface: id.startsWith('REP') ? 'apps/web/features/reports' : 'apps/web/features/finance',
  preconditions:
    'Active authenticated organization and explicit permission; mutable tests only in isolated synthetic environment.',
  relevantProfiles: ['administrator', 'finance', 'lawyer', 'secretary', 'client'],
  states:
    id === 'FIN-009'
      ? ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED']
      : id === 'FIN-013'
        ? ['PENDING_REVIEW', 'CONFIRMED', 'REJECTED', 'NEEDS_CORRECTION']
        : id === 'FIN-006'
          ? ['PENDING', 'APPROVED', 'REJECTED']
          : ['FIN-004', 'FIN-005'].includes(id)
            ? ['PENDING', 'CONFIRMED', 'REVERSED', 'FAILED']
            : ['FIN-003', 'FIN-008'].includes(id)
              ? ['DRAFT', 'OPEN', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'CANCELLED', 'WRITTEN_OFF']
              : [],
  databaseEffects: id.startsWith('REP')
    ? 'Read-only aggregates.'
    : 'State, allocation and audit changes within the corresponding service transaction.',
  storageEffects: ['FIN-013', 'FIN-014'].includes(id)
    ? 'Private objects and compensation.'
    : 'None directly.',
  preparedScenarios:
    scenarios[id] ?? (['cash-flow', 'cash-flow-by-client'].includes(name) ? ['REPORT-001'] : []),
  evidenceScope: 'See ETAPA_3_FINANCEIRO.md; prepared PostgreSQL scenarios have NOT run in stage3.',
  defectId: id === 'FIN-008' ? 'DEF-006' : id === 'FIN-014' ? 'DEF-007' : null,
}));
const mapped = new Set(features.flatMap((f) => f.candidateIds));
const finance = candidates.filter((c) => ['finance', 'reports'].includes(c.area));
if (mapped.size !== 71 || finance.some((c) => !mapped.has(c.id)))
  throw Error('Financial candidates remain unmapped.');
const result = {
  schema: 1,
  sourceInventorySha256: createHash('sha256').update(raw).digest('hex'),
  sourceCandidates: 213,
  financialCandidates: 71,
  financialUniqueFeatures: features.length,
  remainingCandidatesNotDeduplicated: 142,
  globalUniqueFeatures: null,
  statuses: Object.fromEntries(
    ['PASS', 'FAIL', 'PARTIAL', 'BLOCKED', 'NOT_EXECUTED'].map((s) => [
      s,
      features.filter((f) => f.status === s).length,
    ]),
  ),
  features,
};
const output = `${dir}/FINANCEIRO_FUNCIONAL_ETAPA3.json`,
  csv = `${dir}/MATRIZ_FINANCEIRA_ETAPA3.csv`;
if (!process.argv.includes('--overwrite') && (existsSync(output) || existsSync(csv)))
  throw Error('Preserve previous generated files; use --overwrite explicitly.');
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
const cell = (value) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
writeFileSync(
  csv,
  [
    [
      'id',
      'name',
      'candidates',
      'operations',
      'permissions',
      'status',
      'preparedScenarios',
      'defectId',
    ],
    ...features.map((f) => [
      f.id,
      f.name,
      f.candidateIds.join(';'),
      f.operations.join(';'),
      f.permissions,
      f.status,
      f.preparedScenarios.join(';'),
      f.defectId,
    ]),
  ]
    .map((row) => row.map(cell).join(','))
    .join('\n') + '\n',
);
console.log(
  JSON.stringify({
    candidates: 213,
    financialMapped: mapped.size,
    uniqueFinancial: features.length,
    statuses: result.statuses,
    globalUnique: null,
  }),
);
