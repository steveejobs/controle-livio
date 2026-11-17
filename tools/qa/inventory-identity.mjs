import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve, relative } from 'node:path';

const require = createRequire(import.meta.url),
  { Prisma } = require('@prisma/client');
const output = process.argv[2];
if (!output || existsSync(output))
  throw new Error('Provide a new output directory; existing reports are preserved');
mkdirSync(output, { recursive: true });
const root = process.cwd(),
  docs = 'docs/auditoria-2026-11-04';
const read = (p) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const candidates = JSON.parse(read(docs + '/INVENTARIO_FUNCIONAL_COMPLETO.json'));
const supplementalCandidates = [
  {
    id: 'SURF-214',
    area: 'clients',
    kind: 'web:local-action',
    description: 'Local identity OCR, review and application',
    source: 'apps/web/features/clients/identification-capture.tsx',
    status: 'PARTIAL',
  },
  {
    id: 'SURF-215',
    area: 'clients',
    kind: 'web:local-action',
    description: 'Compose/copy/open WhatsApp message without delivery guarantee',
    source: 'apps/web/features/clients/whatsapp-collection.tsx',
    status: 'PARTIAL',
  },
];
const financial = JSON.parse(read(docs + '/FINANCEIRO_FUNCIONAL_ETAPA3.json'));
const specs = [
  [
    'CLI-001',
    'Cadastro PF/PJ',
    'client-management',
    'clients.controller',
    'clients.service',
    'clients:create',
    ['SURF-020', 'SURF-105'],
    'create/person/company/qualification/address',
  ],
  [
    'CLI-002',
    'Atualizacao cadastral',
    'client-detail',
    'clients.controller',
    'clients.service',
    'clients:update',
    ['SURF-011', 'SURF-106'],
    'edit/clear/reviewed-version/custom-fields',
  ],
  [
    'CLI-003',
    'Pesquisa e paginacao',
    'client-management',
    'clients.controller',
    'clients.service',
    'clients:view',
    ['SURF-099', 'SURF-076'],
    'search/name/tax-id/email/phone/pagination',
  ],
  [
    'CLI-004',
    'Ficha e vinculos',
    'client-detail',
    'clients.controller',
    'clients.service',
    'clients:view',
    ['SURF-100', 'SURF-101'],
    'read/overview/history/relations',
  ],
  [
    'CLI-005',
    'Arquivamento',
    'API_ONLY',
    'clients.controller',
    'clients.service',
    'clients:delete',
    ['SURF-107'],
    'soft-delete/retain-history',
  ],
  [
    'CLI-006',
    'Contatos',
    'client-detail',
    'clients.controller',
    'clients.service',
    'clients:create/update',
    ['SURF-012', 'SURF-108', 'SURF-109'],
    'add/edit-API/primary',
  ],
  [
    'CLI-007',
    'Fotografia privada',
    'client-photo',
    'clients.controller',
    'clients.service',
    'clients:view/update',
    ['SURF-022', 'SURF-023', 'SURF-024', 'SURF-102', 'SURF-103', 'SURF-104'],
    'upload/read/replace/remove',
  ],
  [
    'CLI-008',
    'Notas internas vinculadas',
    'client-detail',
    'work.controller',
    'work.service',
    'notes:view/create',
    ['SURF-015', 'SURF-201', 'SURF-202'],
    'create/read/confidential',
  ],
  [
    'CLI-009',
    'Mensagens ao cliente',
    'client-detail',
    'work.controller',
    'work.service',
    'messages:view/create',
    ['SURF-015', 'SURF-074', 'SURF-203', 'SURF-204'],
    'create/read/portal',
  ],
  [
    'CLI-010',
    'Comunicacao WhatsApp',
    'whatsapp-collection',
    'NO_API_REQUIRED',
    'NO_SERVER_EFFECT',
    'client-facing authorized view',
    [],
    'compose/copy/external-link; no delivery guarantee',
  ],
  [
    'IDN-001',
    'Importacao de identidade',
    'identification-capture',
    'LOCAL_BROWSER',
    'identification-reader',
    'clients:create + documents:create',
    [],
    'select/preview/local-ocr/review/conflict/apply/discard',
  ],
  [
    'DOC-001',
    'Documentos privados vinculados',
    'documents',
    'documents.controller',
    'documents.service',
    'documents:view/create',
    [
      'SURF-016',
      'SURF-017',
      'SURF-019',
      'SURF-021',
      'SURF-029',
      'SURF-032',
      'SURF-075',
      'SURF-121',
      'SURF-123',
      'SURF-124',
      'SURF-125',
    ],
    'upload/list/associate/private-download',
  ],
  [
    'DOC-002',
    'Versionamento documental',
    'documents',
    'documents.controller',
    'documents.service',
    'documents:update',
    ['SURF-031', 'SURF-122'],
    'new-version/history/revoke-pending-signature',
  ],
  [
    'DOC-003',
    'Geracao documental',
    'client-detail',
    'documents.controller',
    'document-generator.service',
    'documents:create',
    ['SURF-018', 'SURF-115'],
    'generate/procuracao/hipossuficiencia/contract',
  ],
  [
    'DOC-004',
    'Qualificacao do escritorio',
    'documents',
    'documents.controller',
    'document-settings.service',
    'administrator + organization:view/update',
    ['SURF-028', 'SURF-030', 'SURF-116', 'SURF-117'],
    'read/update-office-settings',
  ],
  [
    'DOC-005',
    'Templates',
    'document-template-editor',
    'documents.controller',
    'document-settings.service',
    'administrator + organization:view/update',
    ['SURF-025', 'SURF-026', 'SURF-027', 'SURF-118', 'SURF-119', 'SURF-120'],
    'list/update/reset-template',
  ],
  [
    'DOC-006',
    'Assinatura documental',
    'signing-experience',
    'document-signing.controller',
    'document-signing.service',
    'documents:create + public-token',
    [
      'SURF-033',
      'SURF-034',
      'SURF-035',
      'SURF-036',
      'SURF-111',
      'SURF-112',
      'SURF-113',
      'SURF-114',
    ],
    'request/view/sign/revoke/expiry/retain-proof',
  ],
];
const features = specs.map(([id, name, ui, endpoint, service, permission, ids, operations]) => ({
  id,
  name,
  ui,
  endpoint,
  service,
  permission,
  candidateIds: ids,
  operations: operations.split('/'),
  implemented: true,
  status: id === 'CLI-005' ? 'NOT_EXECUTED' : 'PARTIAL',
  evidenceLevel: 'source + applicable unit/browser evidence; no new PostgreSQL proof',
  persistence:
    id === 'IDN-001'
      ? 'no OCR draft persistence; confirmed fields are sent by CLI-001'
      : id.startsWith('DOC')
        ? 'documents/document_versions/signing/settings + Storage'
        : 'clients/contacts/activity/audit; depends on operation',
  statesAndErrors: 'see identity-stage5 report and per-case evidence',
  scopeOverlap:
    id === 'DOC-001' || id === 'DOC-003' || id === 'CLI-004'
      ? 'Shares primitives with FIN-014/FIN-002; do not add blindly to global unique count'
      : null,
}));
features.find((f) => f.id === 'IDN-001').candidateIds = ['SURF-214'];
features.find((f) => f.id === 'CLI-010').candidateIds = ['SURF-215'];
const mapped = new Map(features.flatMap((f) => f.candidateIds.map((id) => [id, f.id])));
const linked = [...candidates, ...supplementalCandidates]
  .filter(
    (c) =>
      mapped.has(c.id) ||
      ['clients', 'documents'].includes(c.area) ||
      ['SURF-074', 'SURF-075', 'SURF-076', 'SURF-201', 'SURF-202', 'SURF-203', 'SURF-204'].includes(
        c.id,
      ),
  )
  .map((c) => ({
    ...c,
    identityFeatureId:
      mapped.get(c.id) ?? { 'SURF-013': 'FIN-002', 'SURF-014': 'FIN-003' }[c.id] ?? null,
    identityFeatureIds: features.filter((f) => f.candidateIds.includes(c.id)).map((f) => f.id),
    scope: mapped.has(c.id) ? 'IN_SCOPE' : 'RELATED_FINANCIAL_OR_UNRESOLVED_ALIAS',
    stage5Status: 'PARTIAL',
  }));
const inventory = {
  sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceCandidates: candidates.length,
  cumulativeCandidateRecords: candidates.length + supplementalCandidates.length,
  supplementalCandidates,
  financialCandidatesPreserved: financial.financialCandidates,
  financialUniquePreserved: financial.financialUniqueFeatures,
  globalUniqueFeatures: null,
  identityUniqueFeatures: features.length,
  linkedCandidates: linked.length,
  features,
  candidates: linked,
  absentCapabilities: [
    'Identity PDF OCR',
    'Identity multiple images/pages in one read',
    'Parentage/issue/expiry/CNH registration fields',
    'QR/barcode/MRZ/authenticity verification',
    'Persisted distinction between raw OCR and reviewed identity',
    'OCR import on existing client detail',
  ],
  note: 'No historical inventory overwritten; stage statuses do not confer financial PASS',
};
writeFileSync(
  join(output, 'INVENTARIO_IDENTIDADE.json'),
  JSON.stringify(inventory, null, 2) + '\n',
);
const csv = (rows) =>
  rows
    .map((row) => row.map((x) => '"' + String(x ?? '').replaceAll('"', '""') + '"').join(','))
    .join('\n') + '\n';
writeFileSync(
  join(output, 'MATRIZ_IDENTIDADE.csv'),
  csv([
    [
      'id',
      'name',
      'operations',
      'ui',
      'endpoint',
      'service',
      'permission',
      'persistence',
      'status',
      'candidateIds',
    ],
    ...features.map((f) => [
      f.id,
      f.name,
      f.operations.join(';'),
      f.ui,
      f.endpoint,
      f.service,
      f.permission,
      f.persistence,
      f.status,
      f.candidateIds.join(';'),
    ]),
  ]),
);

const models = Prisma.dmmf.datamodel.models,
  quote = (s) => '"' + s.replaceAll('"', '""') + '"';
const relations = [];
for (const model of models)
  for (const f of model.fields.filter((x) => x.kind === 'object' && x.relationFromFields?.length)) {
    const parent = models.find((x) => x.name === f.type);
    const col = (m, n) => quote(m.fields.find((x) => x.name === n).dbName ?? n);
    const pairs = f.relationFromFields.map(
      (name, i) => `c.${col(model, name)}=p.${col(parent, f.relationToFields[i])}`,
    );
    const nonnull = f.relationFromFields.map((n) => `c.${col(model, n)} IS NOT NULL`).join(' AND ');
    const sql = `SELECT count(*) AS invalid_references FROM public.${quote(model.dbName ?? model.name)} c WHERE ${nonnull} AND NOT EXISTS (SELECT 1 FROM public.${quote(parent.dbName ?? parent.name)} p WHERE ${pairs.join(' AND ')});`;
    relations.push({
      model: model.name,
      relation: f.name,
      target: parent.name,
      optional: !f.isRequired,
      fields: f.relationFromFields,
      onDelete: f.relationOnDelete ?? 'DEFAULT',
      status: 'NOT_EXECUTED',
      sql,
    });
    if (
      model.fields.some((x) => x.name === 'organizationId') &&
      parent.fields.some((x) => x.name === 'organizationId') &&
      !f.relationFromFields.includes('organizationId')
    )
      relations.push({
        model: model.name,
        relation: f.name,
        target: parent.name,
        status: 'NOT_EXECUTED',
        check: 'same organization',
        sql: `SELECT count(*) AS mismatched_organizations FROM public.${quote(model.dbName ?? model.name)} c JOIN public.${quote(parent.dbName ?? parent.name)} p ON ${pairs.join(' AND ')} WHERE c.organization_id<>p.organization_id;`,
      });
  }
writeFileSync(
  join(output, 'RELACOES_PRISMA.json'),
  JSON.stringify(
    {
      models: models.length,
      relations: relations.filter((x) => !x.check).length,
      checks: relations,
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  join(output, 'INTEGRIDADE_READONLY.sql'),
  '-- Generated only. No database connected. Soft-deleted/history records remain legitimate.\n' +
    relations
      .map(
        (r) => '-- ' + r.model + '.' + r.relation + ' ' + (r.check ?? 'reference') + '\n' + r.sql,
      )
      .join('\n') +
    '\n',
);
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .filter(Boolean)
  .map((p) => p.replaceAll('\\', '/'));
const codeFiles = files.filter((p) => /\.(?:ts|tsx|mjs|js|json|yml|toml|md|css)$/.test(p));
const text = new Map(codeFiles.map((p) => [p, read(p)]));
const consumers = new Map();
const register = (p, from) => {
  if (!consumers.has(p)) consumers.set(p, new Set());
  consumers.get(p).add(from);
};
for (const [p, s] of text)
  for (const match of s.matchAll(/(?:from\s*|import\s*\(?|require\s*\()\s*['"]([^'"]+)['"]/g)) {
    const name = match[1];
    let base;
    if (name.startsWith('.')) base = resolve(dirname(p), name);
    else if (name.startsWith('@livio/'))
      base = resolve(
        'packages',
        { db: 'db', shared: 'shared', ui: 'ui' }[name.slice(7)] ?? name.slice(7),
        'src/index',
      );
    else continue;
    for (const suffix of [
      '',
      '.ts',
      '.tsx',
      '.mjs',
      '.js',
      '.json',
      '.css',
      '/index.ts',
      '/index.tsx',
    ]) {
      const dest = relative(root, base + suffix).replaceAll('\\', '/');
      if (files.includes(dest)) {
        register(dest, p);
        break;
      }
    }
  }
const resourceRows = [];
for (const p of files) {
  const used = [...(consumers.get(p) ?? [])];
  const framework =
    /apps\/web\/app\/.*(?:page|layout|route|error|loading|not-found|manifest)\.tsx?$/.test(p) ||
    p === 'apps/api/src/main.ts' ||
    p === 'apps/web/proxy.ts';
  const direct = [...text]
    .filter(
      ([from, s]) =>
        from !== p &&
        (s.includes(p) ||
          (p.startsWith('apps/web/public/') &&
            s.includes('/' + p.slice('apps/web/public/'.length)))),
    )
    .slice(0, 5)
    .map(([from]) => from);
  if (p.startsWith('apps/api/src/documents/assets/'))
    direct.push(
      'apps/api/src/documents/document-generator.service.ts: readFileSync + nest-cli assets',
    );
  const configuration =
    /(?:^|\/)(?:AGENTS\.md|nest-cli\.json|\.gitignore|\.npmrc|\.prettierrc\.json|\.env\..*example)$/.test(
      p,
    );
  const classification = p.includes('def007-proposal/')
    ? 'INCOMPLETE'
    : p.startsWith('docs/') || p.includes('/migrations/')
      ? 'HISTORICAL'
      : configuration ||
          /\.test\.|\.e2e\.|(?:^|\/)(?:package[^/]*\.json|.*config[^/]*\.[^/]+)$/.test(p)
        ? 'INTENTIONAL_INTERNAL'
        : used.length || framework || direct.length
          ? 'ACTIVE'
          : p.startsWith('tools/')
            ? 'INTENTIONAL_INTERNAL'
            : 'UNREFERENCED';
  resourceRows.push({
    id: 'RES-' + createHash('sha256').update(p).digest('hex').slice(0, 12),
    path: p,
    classification,
    consumers: [...used, ...direct],
    proof: framework
      ? 'FRAMEWORK_CONVENTION'
      : used.length
        ? 'IMPORT_GRAPH'
        : direct.length
          ? 'LITERAL_REFERENCE'
          : 'PURPOSE_OR_UNCONFIRMED',
    functionalStatus: 'NOT_GLOBALLY_APPROVED',
    technicalOwner: p.split('/').slice(0, 4).join('/'),
    risk:
      classification === 'UNREFERENCED'
        ? 'Dynamic/config/external use must be excluded before removal'
        : classification === 'INCOMPLETE'
          ? 'Review-only recovery adapters; do not activate'
          : 'Preserve existing purpose',
    action:
      classification === 'UNREFERENCED'
        ? 'REVIEW_NO_DELETION'
        : classification === 'INCOMPLETE'
          ? 'COMPLETE_ADAPTERS_AND_EPHEMERAL_PROOFS'
          : 'PRESERVE',
  });
}
for (const p of [
  'apps/web/public/ocr/worker.min.js',
  'apps/web/public/ocr/por.traineddata.gz',
  'apps/web/public/ocr/tesseract-core.wasm.js',
  'apps/web/public/ocr/tesseract-core.wasm',
])
  if (existsSync(p))
    resourceRows.push({
      id: 'RES-' + createHash('sha256').update(p).digest('hex').slice(0, 12),
      path: p,
      classification: 'GENERATED',
      consumers: ['apps/web/scripts/copy-ocr-assets.mjs'],
      proof: 'BUILD_COPY',
      functionalStatus: 'OCR_LOCAL_TESTED',
      technicalOwner: 'web/OCR',
      risk: 'Generated runtime dependency',
      action: 'PRESERVE',
    });
const reachable = new Set(
  resourceRows.filter((r) => r.proof === 'FRAMEWORK_CONVENTION').map((r) => r.path),
);
let changed = true;
while (changed) {
  changed = false;
  for (const [target, parents] of consumers)
    if (!reachable.has(target) && [...parents].some((parent) => reachable.has(parent))) {
      reachable.add(target);
      changed = true;
    }
}
for (const resource of resourceRows) {
  resource.reachableFromProductEntry = reachable.has(resource.path);
  if (
    resource.classification === 'ACTIVE' &&
    /^apps\/web\/(?:features|components)\//.test(resource.path) &&
    !reachable.has(resource.path)
  ) {
    resource.classification = 'UNREFERENCED';
    resource.risk = 'No live product entry path; may belong to an isolated prototype subtree';
    resource.action = 'REVIEW_DYNAMIC_EXTERNAL_AND_HISTORICAL_USE_NO_DELETION';
  }
}
writeFileSync(join(output, 'RECURSOS.json'), JSON.stringify(resourceRows, null, 2) + '\n');
writeFileSync(
  join(output, 'RECURSOS.csv'),
  csv([
    [
      'id',
      'path',
      'classification',
      'proof',
      'functionalStatus',
      'owner',
      'risk',
      'action',
      'consumers',
    ],
    ...resourceRows.map((r) => [
      r.id,
      r.path,
      r.classification,
      r.proof,
      r.functionalStatus,
      r.technicalOwner,
      r.risk,
      r.action,
      r.consumers.join(';'),
    ]),
  ]),
);
console.log(
  JSON.stringify({
    candidates: candidates.length,
    features: features.length,
    linkedCandidates: linked.length,
    models: models.length,
    relationshipChecks: relations.length,
    resources: resourceRows.length,
    classifications: resourceRows.reduce(
      (a, r) => ((a[r.classification] = (a[r.classification] ?? 0) + 1), a),
      {},
    ),
  }),
);
