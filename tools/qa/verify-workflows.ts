import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { Document as WordDocument, Paragraph, Packer } from 'docx';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { initialRolePermissions, type SystemRoleKey } from '../../packages/shared/src/permissions';

type Account = { token: string; userId: string; organizationId: string };
type Entity = { id: string };
type Page = { items: Array<Entity & { clientId: string }>; total: number };
type JourneyStatus = 'PASS' | 'FAIL' | 'PARTIAL' | 'BLOCKED' | 'NOT_RUN';
type JourneyResult = {
  status: JourneyStatus;
  stage: string;
  evidence: string[];
  error?: string;
};
type DocumentVersion = {
  version: number;
  fileName: string;
  mimeType: string;
  sha256: string;
  sizeBytes: string | bigint;
};
type DocumentSnapshot = Entity & {
  currentVersion: number;
  visibility: string;
  versions: DocumentVersion[];
};
type SchedulerJob = { jobName: string; schedule: string; active: boolean };
type SchedulerRun = {
  jobName: string;
  status: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
};
type SchedulerState = {
  lastScheduledAt: Date | null;
  lastCompletedAt: Date | null;
  lastFailedAt: Date | null;
};
type PreflightSnapshot = {
  writeAuthorized: boolean;
  schedulerJobs: SchedulerJob[];
  schedulerRuns: SchedulerRun[];
  schedulerState: SchedulerState | null;
};

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`QA: configure ${name}`);
  return value;
};

const preflightOnly = process.argv.includes('--preflight');
const environment = required('SUPABASE_ENVIRONMENT');
if (!['development', 'test', 'staging'].includes(environment))
  throw new Error(`QA bloqueado: SUPABASE_ENVIRONMENT=${environment} não é ambiente de teste.`);
const projectRef = required('QA_PROJECT_REF');
const supabaseUrl = required('SUPABASE_URL');
const databaseUrl = new URL(required('DATABASE_URL'));
const directDatabaseUrl = new URL(required('DIRECT_URL'));
const publicSupabaseUrl = new URL(required('NEXT_PUBLIC_SUPABASE_URL'));
assert.equal(
  publicSupabaseUrl.origin,
  new URL(supabaseUrl).origin,
  'A URL pública da web não corresponde ao Supabase da API.',
);
const publicAnonKey = required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const serverAnonKey = required('SUPABASE_ANON_KEY');
if (publicAnonKey !== serverAnonKey)
  throw new Error('A chave pública da web não corresponde à chave Auth da API.');
assert.equal(projectRef, required('SUPABASE_PROJECT_REF'));
assert.equal(projectRef, required('CONFIRM_SUPABASE_PROJECT_REF'));
const supabaseLocal = process.env.SUPABASE_LOCAL === 'true';
const supabaseHost = new URL(supabaseUrl).hostname;
const localDatabase = ['localhost', '127.0.0.1'].includes(supabaseHost);
const isDatabaseForProject = (url: URL) =>
  url.hostname === `db.${projectRef}.supabase.co` ||
  (url.hostname.endsWith('.pooler.supabase.com') &&
    decodeURIComponent(url.username).includes(projectRef));
// Keep empty until an operator verifies Supabase metadata and the separate production ref.
const approvedRemoteTestProjectRefs = new Set<string>();
const knownProductionConnectedProjectRefs = new Set(['ioebcdpyrszokdyaoaqv']);
const allowSharedDatabaseWrites = process.env.QA_ALLOW_SHARED_DATABASE_WRITES === 'true';
const outboundIntegrationVariables = Object.keys(process.env)
  .filter(
    (name) =>
      /^(SMTP_|EMAIL_|MAIL_|RESEND_|SENDGRID_|MAILGUN_|VAPID_|STRIPE_|PAYMENT_|MERCADOPAGO_|PAGARME_|PAGSEGURO_|ASAAS_|EFI_|WHATSAPP_|META_|WEBHOOK_)/i.test(
        name,
      ) || name === 'CRON_SECRET',
  )
  .filter((name) => Boolean(process.env[name]));
const externalDeliveryDisabled = process.env.QA_EXTERNAL_DELIVERY_DISABLED === 'true';
const publicSecretVariables = Object.keys(process.env).filter((name) =>
  /^NEXT_PUBLIC_.*(SERVICE_ROLE|SECRET|PRIVATE_KEY|ACCESS_TOKEN)/i.test(name),
);
assert.deepEqual(
  publicSecretVariables,
  [],
  'Credenciais administrativas ou privadas não podem usar prefixo NEXT_PUBLIC_.',
);
if (supabaseLocal) {
  assert.ok(localDatabase, 'SUPABASE_LOCAL=true exige Auth/Storage locais.');
  assert.ok(['localhost', '127.0.0.1'].includes(databaseUrl.hostname), 'Database local esperado.');
  assert.ok(
    ['localhost', '127.0.0.1'].includes(directDatabaseUrl.hostname),
    'DIRECT_URL local esperado.',
  );
  assert.ok(['localhost', '127.0.0.1'].includes(publicSupabaseUrl.hostname));
} else {
  assert.equal(supabaseHost, `${projectRef}.supabase.co`);
  assert.ok(
    isDatabaseForProject(databaseUrl),
    'DATABASE_URL não identifica o project ref confirmado.',
  );
  assert.ok(
    isDatabaseForProject(directDatabaseUrl),
    'DIRECT_URL não identifica o project ref confirmado.',
  );
  if (!preflightOnly)
    assert.equal(
      environment,
      'test',
      'Escrita QA remota exige SUPABASE_ENVIRONMENT=test; rótulos development/staging não autorizam escrita.',
    );

  // A regular remote target must be separated from production. Shared mode is limited
  // to the owner-authorized non-commercial run against this exact, previously inspected ref.
  if (
    !approvedRemoteTestProjectRefs.has(projectRef) &&
    !allowSharedDatabaseWrites &&
    !preflightOnly
  ) {
    throw new Error(
      `QA remoto bloqueado para o project ref ${projectRef}: não está na allowlist versionada de alvos TEST/DEV isolados.${knownProductionConnectedProjectRefs.has(projectRef) ? ' A documentação também confirma que este projeto está conectado aos ambientes Production/Preview da Vercel.' : ''} Use uma stack local ou confirme outro projeto separado antes de allowlistar.`,
    );
  }
  const productionProjectRef = process.env.PRODUCTION_SUPABASE_PROJECT_REF;
  if (!preflightOnly) {
    assert.ok(productionProjectRef, 'Configure a ref verificada independentemente da produção.');
    assert.ok(
      knownProductionConnectedProjectRefs.has(productionProjectRef),
      'A ref de produção precisa constar no inventário versionado após verificação no painel Vercel.',
    );
    if (allowSharedDatabaseWrites) {
      assert.ok(
        knownProductionConnectedProjectRefs.has(projectRef),
        'Modo compartilhado só aceita a ref previamente identificada.',
      );
      assert.equal(
        projectRef,
        productionProjectRef,
        'Modo compartilhado exige correspondência explícita com a ref de Production.',
      );
      assert.equal(
        environment,
        'test',
        'Modo compartilhado exige API local com SUPABASE_ENVIRONMENT=test.',
      );
    } else {
      assert.notEqual(
        projectRef,
        productionProjectRef,
        'QA e produção não podem compartilhar projeto.',
      );
    }
  }
}

if (!preflightOnly) {
  assert.equal(
    externalDeliveryDisabled,
    true,
    'Escrita QA exige confirmação de que e-mail, push, cobrança e webhooks externos estão desabilitados.',
  );
  assert.deepEqual(
    outboundIntegrationVariables,
    [],
    `Escrita QA bloqueada: credenciais de integrações externas configuradas (${outboundIntegrationVariables.join(', ')}).`,
  );
}

if (!preflightOnly && process.env.QA_ALLOW_WRITES !== 'true')
  throw new Error('QA mutável exige QA_ALLOW_WRITES=true após o preflight independente.');

const localApi = process.argv.includes('--local-api');
if (!preflightOnly && !localApi)
  throw new Error('QA exige API local para impedir escrita por API publicada.');
const apiUrl = 'http://127.0.0.1:3021/v1';
const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const prisma = new PrismaClient();
const authAdmin = createClient(supabaseUrl, required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const organizations: string[] = [];
const authUsers: string[] = [];
const checks: string[] = [];
const journeys: Record<string, JourneyResult> = {};
let apiProcess: ChildProcess | undefined;
let stage = 'inicialização';
let preflightSnapshot: PreflightSnapshot | undefined;
if (!preflightOnly) mkdirSync('test-results', { recursive: true });
const apiLog = preflightOnly
  ? undefined
  : createWriteStream(`test-results/qa-api-${runId}.log`, { flags: 'wx' });

function verified(label: string) {
  checks.push(label);
  console.log(`OK: ${label}`);
}

async function request<T = Entity>(
  account: Account,
  path: string,
  method = 'GET',
  body?: unknown,
  expected = method === 'POST' ? 201 : 200,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${account.token}`,
      'X-Organization-Id': account.organizationId,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45_000),
  });
  if (response.status !== expected) {
    const error = (await response.json().catch(() => ({}))) as { message?: string };
    assert.fail(
      `${method} ${path}: HTTP ${response.status}, esperado ${expected}. ${error.message ?? ''}`,
    );
  }
  if (!response.headers.get('content-type')?.includes('application/json'))
    return (await response.text()) as T;
  return (await response.json()) as T;
}

async function uploadDocument(
  account: Account,
  metadata: {
    title: string;
    category: string;
    visibility: 'INTERNAL' | 'CLIENT';
    clientId: string;
  },
  contents: Buffer,
  filename: string,
  mimeType: string,
): Promise<Entity> {
  const form = new FormData();
  for (const [key, value] of Object.entries(metadata)) form.append(key, value);
  form.append('file', new Blob([Uint8Array.from(contents)], { type: mimeType }), filename);
  const response = await fetch(`${apiUrl}/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${account.token}`,
      'X-Organization-Id': account.organizationId,
    },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  if (response.status !== 201) {
    const error = (await response.json().catch(() => ({}))) as { message?: string };
    assert.fail(`POST /documents: HTTP ${response.status}, esperado 201. ${error.message ?? ''}`);
  }
  return response.json() as Promise<Entity>;
}

async function uploadDocumentVersion(
  account: Account,
  documentId: string,
  contents: Buffer,
  filename: string,
  mimeType: string,
): Promise<void> {
  const form = new FormData();
  form.append('file', new Blob([Uint8Array.from(contents)], { type: mimeType }), filename);
  const response = await fetch(`${apiUrl}/documents/${documentId}/versions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${account.token}`,
      'X-Organization-Id': account.organizationId,
    },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  if (response.status !== 201) {
    const error = (await response.json().catch(() => ({}))) as { message?: string };
    assert.fail(
      `POST /documents/${documentId}/versions: HTTP ${response.status}, esperado 201. ${error.message ?? ''}`,
    );
  }
}

function pngCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(pngCrc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}

function syntheticSignaturePng(): Buffer {
  const width = 48;
  const height = 14;
  const pixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    pixels.push(0);
    for (let x = 0; x < width; x += 1) {
      const mark = Math.abs(y - Math.floor(x / 4) - 3) < 2;
      pixels.push(23, 63, 56, mark ? 255 : 0);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const image = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from(pixels))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  assert.ok(image.length >= 100);
  return image;
}

async function syntheticDocx(label: string): Promise<Buffer> {
  const document = new WordDocument({
    sections: [{ children: [new Paragraph({ text: label })] }],
  });
  return Buffer.from(await Packer.toBuffer(document));
}

async function syntheticPdf(label: string): Promise<Buffer> {
  const document = await PDFDocument.create();
  const page = document.addPage();
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(label.slice(0, 120), { x: 48, y: page.getHeight() - 48, font, size: 11 });
  return Buffer.from(await document.save());
}

async function publicSignatureRequest<T>(
  token: string,
  action: 'details' | 'sign',
  body?: unknown,
  expectedStatus = 200,
): Promise<T> {
  const response = await fetch(
    `${apiUrl}/public/signatures/${encodeURIComponent(token)}${action === 'sign' ? '/sign' : ''}`,
    {
      method: action === 'sign' ? 'POST' : 'GET',
      ...(body
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
      signal: AbortSignal.timeout(45_000),
    },
  );
  if (response.status !== expectedStatus) {
    const error = (await response.json().catch(() => ({}))) as { message?: string };
    assert.fail(
      `Public signature ${action}: HTTP ${response.status}, esperado ${expectedStatus}. ${
        error.message?.replaceAll(token, '[TOKEN REDACTED]') ?? ''
      }`,
    );
  }
  if (!response.headers.get('content-type')?.includes('application/json'))
    return (await response.text()) as T;
  return (await response.json()) as T;
}

function assertMagicBytes(buffer: Buffer, version: DocumentVersion, expectedMimeType: string) {
  assert.equal(
    version.mimeType,
    expectedMimeType,
    `Versão ${version.version}: MIME persistido incorreto.`,
  );
  if (expectedMimeType === 'application/pdf') {
    assert.equal(
      buffer.subarray(0, 5).toString('ascii'),
      '%PDF-',
      `Versão ${version.version}: conteúdo não é PDF.`,
    );
    assert.match(
      version.fileName.toLowerCase(),
      /\.pdf$/,
      `Versão ${version.version}: extensão PDF ausente.`,
    );
    return;
  }
  assert.equal(
    expectedMimeType,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    `Versão ${version.version}: formato inesperado.`,
  );
  assert.equal(
    buffer.subarray(0, 4).toString('hex'),
    '504b0304',
    `Versão ${version.version}: conteúdo DOCX não tem assinatura ZIP válida.`,
  );
  assert.match(
    version.fileName.toLowerCase(),
    /\.docx$/,
    `Versão ${version.version}: extensão DOCX ausente.`,
  );
}

function signedUrlClaims(token: string): { exp: number; iat: number } {
  const parts = token.split('.');
  assert.equal(parts.length, 3, 'URL assinada: token não é um JWT verificável.');
  const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  assert.equal(typeof claims.exp, 'number', 'URL assinada: claim exp ausente.');
  assert.equal(typeof claims.iat, 'number', 'URL assinada: claim iat ausente.');
  return { exp: claims.exp as number, iat: claims.iat as number };
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Falha não identificada.';
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '[UUID]')
    .replace(/\b[a-f0-9]{64}\b/gi, '[TOKEN/HASH]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}

async function verifyDocumentHistory(
  admin: Account,
  documentId: string,
  expectedVersions: Array<{ version: number; mimeType: string }>,
  expiryFailures: Array<{ stage: string; message: string }>,
): Promise<DocumentSnapshot> {
  const document = await request<DocumentSnapshot>(admin, `/documents/${documentId}`);
  assert.ok(Array.isArray(document.versions), `Documento ${documentId}: API não retornou versões.`);
  const persisted = await prisma.documentVersion.findMany({
    where: { documentId, organizationId: admin.organizationId },
    orderBy: { version: 'asc' },
    select: { version: true, fileName: true, mimeType: true, sha256: true, sizeBytes: true },
  });
  const expectedNumbers = expectedVersions.map(({ version }) => version);
  assert.deepEqual(
    persisted.map(({ version }) => version),
    expectedNumbers,
    `Documento ${documentId}: esperava versões ${expectedNumbers.join(', ')}, encontrou ${persisted.map(({ version }) => version).join(', ') || 'nenhuma'}.`,
  );
  assert.equal(
    document.currentVersion,
    expectedNumbers.at(-1),
    'Documento: versão atual divergente.',
  );
  assert.deepEqual(
    document.versions.map(({ version }) => version),
    [...expectedNumbers].reverse(),
    'API: histórico de versões não coincide com os registros persistidos.',
  );
  for (const storedVersion of persisted) {
    const apiVersion = document.versions.find(({ version }) => version === storedVersion.version);
    assert.ok(
      apiVersion,
      `API: versão ${storedVersion.version} ausente no histórico do documento.`,
    );
    assert.equal(apiVersion.fileName, storedVersion.fileName);
    assert.equal(apiVersion.mimeType, storedVersion.mimeType);
    assert.equal(apiVersion.sha256, storedVersion.sha256);
    assert.equal(String(apiVersion.sizeBytes), String(storedVersion.sizeBytes));
  }

  for (let index = 0; index < expectedVersions.length; index += 1) {
    const expected = expectedVersions[index]!;
    const version = persisted[index];
    assert.ok(
      version,
      `Documento ${documentId}: versão ${expected.version} ausente no PostgreSQL.`,
    );
    stage = `documentos: download da versão ${expected.version} (${expected.mimeType})`;
    assert.equal(version.version, expected.version);
    assert.equal(
      version.mimeType,
      expected.mimeType,
      `Versão ${expected.version}: MIME persistido incorreto.`,
    );

    const signed = await request<{ url: string; expiresInSeconds: number; version: number }>(
      admin,
      `/documents/${documentId}/download-url?version=${expected.version}`,
    );
    assert.equal(signed.version, expected.version, `URL assinada aponta para outra versão.`);
    const versionStage = `documentos: URL assinada da versão ${expected.version}`;
    if (signed.expiresInSeconds !== 300)
      expiryFailures.push({
        stage: versionStage,
        message: `API declarou ${signed.expiresInSeconds}s, esperado 300s.`,
      });
    const url = new URL(signed.url);
    assert.equal(
      url.origin,
      new URL(supabaseUrl).origin,
      'URL assinada aponta para outro projeto.',
    );
    assert.match(
      url.pathname,
      /\/storage\/v1\/object\/sign\//,
      'A URL não é um link assinado do Storage.',
    );
    const token = url.searchParams.get('token');
    assert.ok(token, 'URL assinada não contém token de Storage.');
    const now = Math.floor(Date.now() / 1000);
    const { exp, iat } = signedUrlClaims(token);
    const actualTtlSeconds = exp - iat;
    if (exp <= now || actualTtlSeconds !== 300 || actualTtlSeconds !== signed.expiresInSeconds)
      expiryFailures.push({
        stage: versionStage,
        message: `JWT exp=${exp}, iat=${iat}, TTL=${actualTtlSeconds}s; API declarou ${signed.expiresInSeconds}s e espera 300s.`,
      });

    const downloaded = await fetch(signed.url, { signal: AbortSignal.timeout(15_000) });
    assert.equal(
      downloaded.status,
      200,
      `Versão ${expected.version}: download assinado retornou HTTP ${downloaded.status}.`,
    );
    const downloadedMimeType = downloaded.headers.get('content-type')?.split(';')[0];
    assert.equal(
      downloadedMimeType,
      version.mimeType,
      `Versão ${expected.version}: MIME do download divergente.`,
    );
    const buffer = Buffer.from(await downloaded.arrayBuffer());
    assert.ok(buffer.length > 0, `Versão ${expected.version}: arquivo baixado vazio.`);
    assert.equal(
      String(version.sizeBytes),
      String(buffer.length),
      `Versão ${expected.version}: tamanho baixado diverge do PostgreSQL.`,
    );
    assertMagicBytes(buffer, version, expected.mimeType);
    assert.equal(
      createHash('sha256').update(buffer).digest('hex'),
      version.sha256,
      `Versão ${expected.version}: SHA-256 do download não coincide com o PostgreSQL.`,
    );
  }
  return document;
}

function recordJourney(
  name: string,
  status: JourneyStatus,
  evidenceFrom: number | string[],
  error?: unknown,
) {
  journeys[name] = {
    status,
    stage,
    evidence: typeof evidenceFrom === 'number' ? checks.slice(evidenceFrom) : evidenceFrom,
    ...(error ? { error: safeErrorMessage(error) } : {}),
  };
  if (error) {
    const message = safeErrorMessage(error);
    console.error(`QA ${name}: ${status} na etapa "${stage}": ${message}`);
    process.exitCode = 1;
  }
}

async function organization(suffix: string) {
  const created = await prisma.organization.create({
    data: {
      slug: `qa-workflows-${runId}-${suffix}`,
      legalName: `QA fictício ${runId} ${suffix}`,
    },
  });
  organizations.push(created.id);
  const codes = [...new Set(Object.values(initialRolePermissions).flat())];
  await prisma.permission.createMany({
    data: codes.map((code) => {
      const [resource, action] = code.split(':');
      return { organizationId: created.id, resource: resource!, action: action! };
    }),
  });
  return created.id;
}

async function account(
  organizationId: string,
  key: SystemRoleKey,
  clientId?: string,
): Promise<Account> {
  const email = `qa-${runId}-${authUsers.length}@example.test`;
  const password = randomBytes(32).toString('base64url');
  const created = await authAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  const authUser = created.data.user!;
  authUsers.push(authUser.id);
  const userId = await prisma.$transaction(
    async (transaction) => {
      await transaction.profile.upsert({
        where: { id: authUser.id },
        create: { id: authUser.id, email, fullName: `QA ${key}` },
        update: { fullName: `QA ${key}` },
      });
      const user = await transaction.user.create({
        data: {
          organizationId,
          authUserId: authUser.id,
          email,
          fullName: `QA ${key}`,
          status: 'ACTIVE',
          ...(clientId ? { clientId } : {}),
        },
      });
      const membership = await transaction.organizationMember.create({
        data: {
          organizationId,
          profileId: authUser.id,
          userId: user.id,
          status: 'ACTIVE',
          ...(clientId ? { clientId } : {}),
        },
      });
      const permissions = await transaction.permission.findMany({ where: { organizationId } });
      const permitted = new Set<string>(initialRolePermissions[key]);
      const role = await transaction.role.create({
        data: {
          organizationId,
          key,
          name: key,
          isSystem: true,
          permissions: {
            create: permissions
              .filter((permission) => permitted.has(`${permission.resource}:${permission.action}`))
              .map((permission) => ({ organizationId, permissionId: permission.id })),
          },
        },
      });
      await transaction.organizationMemberRole.create({
        data: { organizationId, membershipId: membership.id, roleId: role.id },
      });
      await transaction.userRole.create({
        data: { organizationId, userId: user.id, roleId: role.id },
      });
      return user.id;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  const client = createClient(supabaseUrl, required('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  assert.ifError(signedIn.error);
  assert.ok(signedIn.data.session?.access_token);
  return { token: signedIn.data.session.access_token, userId, organizationId };
}

async function startApi() {
  if (localApi) {
    assert.ok(existsSync('apps/api/dist/main.js'), 'Execute npm run build:api antes do QA.');
    apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
      shell: false,
      windowsHide: true,
      env: { ...process.env, NODE_ENV: 'development', API_PORT: '3021', LOG_LEVEL: 'error' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    apiProcess.stdout?.pipe(apiLog!);
    apiProcess.stderr?.pipe(apiLog!);
  }
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiUrl}/health/ready`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
    } catch {
      /* Wait for the compiled API to start. */
    }
    if (apiProcess?.exitCode != null)
      throw new Error('A API encerrou antes do teste. Consulte o log local de QA.');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('A API não ficou pronta no prazo de 90 segundos.');
}

async function preflight(): Promise<PreflightSnapshot> {
  const supabaseHost = new URL(supabaseUrl).hostname;
  const [databaseRows, authResponse, buckets] = await Promise.all([
    prisma.$queryRaw<
      Array<{ database: string; databaseRole: string; serverAddress: string | null }>
    >`
      SELECT current_database() AS database,
             current_user AS "databaseRole",
             inet_server_addr()::text AS "serverAddress"
    `,
    fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: required('SUPABASE_ANON_KEY') },
      signal: AbortSignal.timeout(15_000),
    }),
    authAdmin.storage.listBuckets(),
  ]);
  assert.equal(authResponse.status, 200, `Auth settings respondeu HTTP ${authResponse.status}.`);
  const authSettings = (await authResponse.json()) as { disable_signup?: unknown };
  const publicSignupDisabled = authSettings.disable_signup === true;
  assert.ifError(buckets.error);
  const bucketNames = buckets.data.map(({ name }) => name);
  for (const requiredBucket of ['legal-documents', 'client-photos', 'document-signatures'])
    assert.ok(bucketNames.includes(requiredBucket), `Bucket ${requiredBucket} não encontrado.`);
  const database = databaseRows[0];
  assert.ok(database, 'PostgreSQL não retornou metadados de conexão.');
  assert.equal(database.database, 'postgres', 'Database conectado tem nome inesperado.');
  const rlsTables = await prisma.$queryRaw<
    Array<{ tableName: string; rlsEnabled: boolean; rlsForced: boolean }>
  >`
    SELECT c.relname AS "tableName",
           c.relrowsecurity AS "rlsEnabled",
           c.relforcerowsecurity AS "rlsForced"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = ANY(ARRAY[
         'clients', 'matters', 'client_contacts', 'contracts', 'receivables',
         'payments', 'expenses', 'documents', 'document_versions', 'tasks',
         'calendar_events', 'notifications', 'client_messages'
       ])
  `;
  assert.equal(rlsTables.length, 13, 'Faltam tabelas da matriz QA no schema public.');
  const unprotected = rlsTables.filter((table) => !table.rlsEnabled || !table.rlsForced);
  assert.deepEqual(
    unprotected.map(({ tableName }) => tableName),
    [],
    'RLS não está habilitada e forçada em todas as tabelas da matriz QA.',
  );
  const pushSubscriptionCount = await prisma.webPushSubscription.count();
  const existingRunOrganizations = await prisma.organization.count({
    where: { slug: { startsWith: `qa-workflows-${runId}` } },
  });
  assert.equal(existingRunOrganizations, 0, 'Já existem organizações para este runId.');

  const productionProjectRef = process.env.PRODUCTION_SUPABASE_PROJECT_REF;
  const databaseProjectIdentityMatches =
    supabaseLocal ||
    decodeURIComponent(databaseUrl.username).includes(projectRef) ||
    database.databaseRole.includes(projectRef) ||
    databaseUrl.hostname === `db.${projectRef}.supabase.co`;
  const directDatabaseProjectIdentityMatches =
    supabaseLocal || isDatabaseForProject(directDatabaseUrl);
  const [cronCatalog, schedulerState] = await Promise.all([
    prisma.$queryRaw<Array<{ jobCatalog: string | null }>>`
      SELECT to_regclass('cron.job')::text AS "jobCatalog"
    `,
    prisma.$queryRaw<
      Array<{
        lastScheduledAt: Date | null;
        lastCompletedAt: Date | null;
        lastFailedAt: Date | null;
      }>
    >`
      SELECT last_scheduled_at AS "lastScheduledAt",
             last_completed_at AS "lastCompletedAt",
             last_failed_at AS "lastFailedAt"
        FROM scheduled_job_state
       WHERE job_name = 'notifications'
    `,
  ]);
  let schedulerJobs: Array<{ jobName: string; schedule: string; active: boolean }> = [];
  let schedulerRuns: Array<{
    jobName: string;
    status: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }> = [];
  if (cronCatalog[0]?.jobCatalog) {
    try {
      schedulerJobs = await prisma.$queryRaw<
        Array<{ jobName: string; schedule: string; active: boolean }>
      >`
        SELECT jobname AS "jobName", schedule, active
          FROM cron.job
         WHERE jobname = 'livio-notifications'
         ORDER BY jobname
      `;
      const runCatalog = await prisma.$queryRaw<Array<{ runCatalog: string | null }>>`
        SELECT to_regclass('cron.job_run_details')::text AS "runCatalog"
      `;
      if (runCatalog[0]?.runCatalog)
        schedulerRuns = await prisma.$queryRaw<
          Array<{
            jobName: string;
            status: string | null;
            startedAt: Date | null;
            completedAt: Date | null;
          }>
        >`
          SELECT j.jobname AS "jobName",
                 d.status,
                 d.start_time AS "startedAt",
                 d.end_time AS "completedAt"
            FROM cron.job_run_details d
            JOIN cron.job j ON j.jobid = d.jobid
          WHERE j.jobname = 'livio-notifications'
           ORDER BY d.start_time DESC
           LIMIT 10
        `;
    } catch {
      // Keep scheduler metadata explicitly unavailable; never infer active state from config.
      schedulerJobs = [];
      schedulerRuns = [];
    }
  }
  const productionReferenceVerified = Boolean(
    productionProjectRef && knownProductionConnectedProjectRefs.has(productionProjectRef),
  );
  const localDestinationsVerified =
    supabaseLocal &&
    localDatabase &&
    ['localhost', '127.0.0.1'].includes(databaseUrl.hostname) &&
    ['localhost', '127.0.0.1'].includes(directDatabaseUrl.hostname) &&
    externalDeliveryDisabled &&
    outboundIntegrationVariables.length === 0 &&
    publicSecretVariables.length === 0;
  const remoteDestinationsVerified =
    approvedRemoteTestProjectRefs.has(projectRef) &&
    environment === 'test' &&
    productionReferenceVerified &&
    productionProjectRef !== projectRef &&
    databaseProjectIdentityMatches &&
    directDatabaseProjectIdentityMatches &&
    externalDeliveryDisabled &&
    outboundIntegrationVariables.length === 0 &&
    publicSecretVariables.length === 0 &&
    rlsTables.length === 13 &&
    unprotected.length === 0;
  const sharedDatabaseDestinationsVerified =
    allowSharedDatabaseWrites &&
    projectRef === 'ioebcdpyrszokdyaoaqv' &&
    productionProjectRef === projectRef &&
    productionReferenceVerified &&
    environment === 'test' &&
    databaseProjectIdentityMatches &&
    directDatabaseProjectIdentityMatches &&
    externalDeliveryDisabled &&
    outboundIntegrationVariables.length === 0 &&
    publicSecretVariables.length === 0 &&
    pushSubscriptionCount === 0 &&
    publicSignupDisabled &&
    rlsTables.length === 13 &&
    unprotected.length === 0;
  const writeAuthorized =
    localDestinationsVerified || remoteDestinationsVerified || sharedDatabaseDestinationsVerified;
  const currentProjectProductionConnected = knownProductionConnectedProjectRefs.has(projectRef);
  console.log(
    JSON.stringify(
      {
        status: writeAuthorized ? 'PREFLIGHT_PASS' : 'PREFLIGHT_READ_ONLY_ONLY',
        projectRef,
        destinations: {
          auth: supabaseHost,
          postgresHost: databaseUrl.hostname,
          directPostgresHost: directDatabaseUrl.hostname,
          postgresDatabase: database.database,
          databaseProjectIdentityMatches,
          directDatabaseProjectIdentityMatches,
          storage: supabaseHost,
          storageBuckets: bucketNames.sort(),
        },
        rlsTables: rlsTables.length,
        rlsForcedTables: rlsTables.filter(({ rlsEnabled, rlsForced }) => rlsEnabled && rlsForced)
          .length,
        productionProjectRefConfigured: Boolean(productionProjectRef),
        productionReferenceVerified,
        currentProjectProductionConnectedByDocumentation: currentProjectProductionConnected,
        sameProjectAsProduction: productionProjectRef
          ? productionProjectRef === projectRef
          : currentProjectProductionConnected
            ? true
            : null,
        controlPlaneProjectNameVerified: approvedRemoteTestProjectRefs.has(projectRef),
        sharedDatabaseWriteMode: allowSharedDatabaseWrites,
        pushSubscriptionCount,
        publicSignupDisabled,
        outboundIntegrationCredentialsPresent: outboundIntegrationVariables.length > 0,
        externalDeliveryDisabledDeclared: externalDeliveryDisabled,
        writeAuthorized,
        syntheticRunPrefixHasExistingOrganization: false,
        scheduler: {
          catalogAvailable: Boolean(cronCatalog[0]?.jobCatalog),
          jobs: schedulerJobs,
          recentRuns: schedulerRuns,
          applicationState: schedulerState[0] ?? null,
          activeJobCount: schedulerJobs.filter(({ active }) => active).length,
        },
      },
      null,
      2,
    ),
  );
  return {
    writeAuthorized,
    schedulerJobs,
    schedulerRuns,
    schedulerState: schedulerState[0] ?? null,
  };
}

async function run() {
  await startApi();
  stage = 'preparação isolada';
  const orgA = await organization('a');
  const orgB = await organization('b');
  const admin = await account(orgA, 'administrator');
  const finance = await account(orgA, 'finance');
  const lawyer = await account(orgA, 'lawyer');
  const secretary = await account(orgA, 'secretary');
  const outsider = await account(orgB, 'administrator');
  const auth = await request<{ user: { isAdministrator: boolean }; organization: { id: string } }>(
    admin,
    '/auth/me',
  );
  assert.equal(auth.organization.id, orgA);
  assert.equal(auth.user.isAdministrator, true);
  verified('Autenticação Supabase e resolução real de organização/permissões');

  stage = 'convite sem provedor de e-mail';
  const inviteEmail = `qa-invite-${runId}@example.test`;
  const financeRole = await prisma.role.findFirstOrThrow({
    where: { organizationId: orgA, key: 'finance' },
  });
  const invite = await request<{ id: string; invitationUrl: string }>(
    admin,
    '/admin/users',
    'POST',
    {
      email: inviteEmail,
      fullName: 'Profissional fictício convidado',
      roleIds: [financeRole.id],
      delivery: 'LINK',
    },
  );
  const invitedUser = await prisma.user.findUniqueOrThrow({ where: { id: invite.id } });
  authUsers.push(invitedUser.authUserId!);
  const invitation = new URL(invite.invitationUrl);
  if (!localApi) assert.equal(invitation.hostname, 'controle-livio-web.vercel.app');
  assert.equal(invitation.searchParams.get('type'), 'invite');
  const tokenHash = invitation.searchParams.get('token_hash');
  assert.ok(tokenHash);
  const inviteClient = createClient(supabaseUrl, required('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const accepted = await inviteClient.auth.verifyOtp({ type: 'invite', token_hash: tokenHash });
  assert.ifError(accepted.error);
  assert.ok(accepted.data.session?.access_token);
  const invitedPassword = randomBytes(32).toString('base64url');
  const changedPassword = await inviteClient.auth.updateUser({ password: invitedPassword });
  assert.ifError(changedPassword.error);
  const invitedAccount: Account = {
    token: accepted.data.session.access_token,
    userId: invite.id,
    organizationId: orgA,
  };
  const invitedContext = await request<{ organization: { id: string } }>(
    invitedAccount,
    '/auth/me',
  );
  assert.equal(invitedContext.organization.id, orgA);
  const recovery = await request<{ recoveryUrl: string }>(
    admin,
    `/admin/users/${invite.id}/recovery-link`,
    'POST',
  );
  const recoveryLink = new URL(recovery.recoveryUrl);
  if (!localApi) assert.equal(recoveryLink.hostname, 'controle-livio-web.vercel.app');
  const recoveryToken = recoveryLink.searchParams.get('token_hash');
  assert.ok(recoveryToken);
  const recoveryClient = createClient(supabaseUrl, required('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const recovered = await recoveryClient.auth.verifyOtp({
    type: 'recovery',
    token_hash: recoveryToken,
  });
  assert.ifError(recovered.error);
  assert.ok(recovered.data.session);
  const secondPassword = randomBytes(32).toString('base64url');
  assert.ifError((await recoveryClient.auth.updateUser({ password: secondPassword })).error);
  const recoveredLogin = await recoveryClient.auth.signInWithPassword({
    email: inviteEmail,
    password: secondPassword,
  });
  assert.ifError(recoveredLogin.error);
  if (!localApi) {
    const browserRecovery = await request<{ recoveryUrl: string }>(
      admin,
      `/admin/users/${invite.id}/recovery-link`,
      'POST',
    );
    const callback = await fetch(browserRecovery.recoveryUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok([302, 303, 307, 308].includes(callback.status));
    assert.equal(new URL(callback.headers.get('location')!).pathname, '/reset-password');
    assert.ok(callback.headers.get('set-cookie')?.includes('sb-'));
  }
  verified(
    'Convite e recuperação por link consumidos no Supabase Auth, senha definida e acesso à organização',
  );

  stage = 'cadastro PF/PJ e isolamento';
  const address = { street: 'Rua Fictícia QA', number: '10', city: 'São Luís', state: 'MA' };
  const person = await request(admin, '/clients', 'POST', {
    type: 'PERSON',
    displayName: 'Pessoa fictícia QA',
    address,
  });
  const company = await request(admin, '/clients', 'POST', {
    type: 'COMPANY',
    displayName: 'Empresa fictícia QA',
    legalName: 'Empresa fictícia QA Ltda',
    address,
    customFields: {
      legalRepresentative: { name: 'Representante fictício QA' },
    },
  });
  const contact = await request<Entity>(admin, `/clients/${person.id}/contacts`, 'POST', {
    name: 'Contato sintético QA',
    role: 'Responsável',
    email: `qa-contact-${runId}@example.test`,
    isPrimary: true,
  });
  const clientDetails = await request<{ contacts: Entity[] }>(admin, `/clients/${person.id}`);
  assert.ok(clientDetails.contacts.some(({ id }) => id === contact.id));
  await request(
    admin,
    '/clients',
    'POST',
    { type: 'PERSON', displayName: 'Inválido QA', taxId: '11111111111' },
    400,
  );
  await request(outsider, `/clients/${person.id}`, 'GET', undefined, 404);
  await request({ ...admin, organizationId: orgB }, '/clients', 'GET', undefined, 401);
  const pipeline = await request<Entity & { stages: Entity[] }>(admin, '/pipelines', 'POST', {
    name: `Pipeline jurídico QA ${runId}`,
    kind: 'LEGAL',
    stages: [
      { name: 'Triagem QA', position: 0 },
      { name: 'Em andamento QA', position: 1 },
    ],
  });
  const matter = await request<Entity>(admin, '/matters', 'POST', {
    clientId: person.id,
    pipelineId: pipeline.id,
    currentStageId: pipeline.stages[0]!.id,
    responsibleLawyerId: lawyer.userId,
    reference: `QA-${runId}`,
    title: 'Processo sintético de validação',
    status: 'LEAD',
    area: 'CÍVEL',
  });
  await request(finance, '/matters', 'POST', {}, 403);
  await request(finance, '/matters', 'GET');
  await request(secretary, '/clients', 'GET');
  await request(secretary, '/finance/expenses', 'GET', undefined, 403);
  await request(lawyer, `/matters/${matter.id}`, 'PATCH', { status: 'ACTIVE' });
  await request(lawyer, `/matters/${matter.id}/stage-movements`, 'POST', {
    toStageId: pipeline.stages[1]!.id,
    reason: 'Avanço sintético de validação',
  });
  const matterDetails = await request<{
    currentStageId: string;
    responsibleLawyerId: string;
    status: string;
    stageHistory: Entity[];
  }>(lawyer, `/matters/${matter.id}`);
  assert.equal(matterDetails.currentStageId, pipeline.stages[1]!.id);
  assert.equal(matterDetails.responsibleLawyerId, lawyer.userId);
  assert.equal(matterDetails.status, 'ACTIVE');
  assert.equal(matterDetails.stageHistory.length, 2);
  await request(outsider, `/matters/${matter.id}`, 'GET', undefined, 404);
  await request(finance, `/matters/${matter.id}`, 'PATCH', { status: 'ACTIVE' }, 403);
  const matterTimeline = await request<{ entries: Entity[] }>(
    lawyer,
    `/matters/${matter.id}/timeline`,
  );
  assert.equal(matterTimeline.entries.length, 2);
  verified(
    'Clientes/contato/processo, responsável, status/etapa/histórico, permissão financeira e isolamento entre organizações',
  );
  recordJourney('clientes_processos', 'PASS', Math.max(0, checks.length - 1));

  stage = 'foto privada do cliente';
  const photo = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/eWQAAAAASUVORK5CYII=',
    'base64',
  );
  const uploadPhoto = async (account: Account, bytes: Buffer, expected: number) => {
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(bytes)], { type: 'image/png' }), 'cliente.png');
    const response = await fetch(`${apiUrl}/clients/${person.id}/photo`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.token}`,
        'X-Organization-Id': account.organizationId,
      },
      body: form,
      signal: AbortSignal.timeout(45_000),
    });
    assert.equal(response.status, expected);
    return response.json() as Promise<{ url: string }>;
  };
  await uploadPhoto(outsider, photo, 404);
  await uploadPhoto(admin, Buffer.from('arquivo invalido'), 400);
  const uploaded = await uploadPhoto(admin, photo, 201);
  assert.equal((await fetch(uploaded.url)).status, 200);
  assert.ok((await prisma.client.findUniqueOrThrow({ where: { id: person.id } })).photoStorageKey);
  const signed = await request<{ url: string }>(admin, `/clients/${person.id}/photo-url`);
  assert.equal((await fetch(signed.url)).status, 200);
  await request(outsider, `/clients/${person.id}/photo-url`, 'GET', undefined, 404);
  await request(admin, `/clients/${person.id}/photo`, 'DELETE');
  assert.equal((await request<{ url: null }>(admin, `/clients/${person.id}/photo-url`)).url, null);
  verified(
    'Foto privada: upload, assinatura e remoção; arquivo inválido e acesso entre organizações rejeitados',
  );

  const expenseEvidenceStart = checks.length;
  try {
    stage = 'despesas: criação e listagem';
    const expense = await request<Entity>(admin, '/finance/expenses', 'POST', {
      clientId: person.id,
      description: 'Despesa sintética QA',
      category: 'DILIGÊNCIA',
      amount: '74.19',
      incurredAt: new Date().toISOString(),
      reimbursable: true,
    });
    const persistedExpense = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
    assert.equal(persistedExpense.amount.toString(), '74.19');
    const listedExpenses = await request<Page>(admin, '/finance/expenses');
    assert.ok(listedExpenses.items.some(({ id }) => id === expense.id));
    verified('Despesa criada e listada com valor decimal persistido');
    recordJourney('despesas', 'PARTIAL', expenseEvidenceStart);
  } catch (error) {
    recordJourney('despesas', 'FAIL', expenseEvidenceStart, error);
  }

  const financeEvidenceStart = checks.length;
  stage = 'serviços, cobrança, contrato e audiência';
  const service = await request(admin, '/finance/service-catalog', 'POST', {
    name: 'Diligência fictícia QA',
    area: 'CRIMINAL',
  });
  assert.ok(
    (await request<Entity[]>(admin, '/finance/service-catalog')).some(
      (item) => item.id === service.id,
    ),
  );
  const issueDate = new Date().toISOString();
  const receivable = await request<Entity & { installments: Entity[] }>(
    admin,
    '/finance/receivables',
    'POST',
    {
      clientId: person.id,
      reference: `QA-${runId}`,
      description: 'Honorários fictícios QA',
      originalAmount: '1000.00',
      issueDate,
      installments: [
        { sequence: 1, amount: '333.33', dueDate: issueDate },
        { sequence: 2, amount: '333.33', dueDate: issueDate },
        { sequence: 3, amount: '333.34', dueDate: issueDate },
      ],
    },
  );
  const startsAt = new Date(Date.now() + 2 * 86_400_000);
  const contract = await request(admin, '/finance/contracts', 'POST', {
    clientId: person.id,
    receivableId: receivable.id,
    number: `QA-${runId}`,
    title: 'Defesa fictícia QA',
    feeModel: 'FIXED',
    fixedAmount: '1000.00',
    serviceNames: ['Audiência de custódia', 'Diligência fictícia QA'],
    hearings: [
      {
        startsAt: startsAt.toISOString(),
        reminderMinutes: [60, 45, 10],
        location: 'Sala fictícia QA',
      },
    ],
  });
  assert.equal(
    (await prisma.receivable.findUniqueOrThrow({ where: { id: receivable.id } })).contractId,
    contract.id,
  );
  const event = await prisma.calendarEvent.findFirstOrThrow({
    where: { organizationId: orgA, clientId: person.id },
  });
  assert.deepEqual(event.reminderMinutes, [60, 45, 10]);
  const countAlerts = () =>
    prisma.notification.count({
      where: {
        organizationId: orgA,
        status: 'PENDING',
        metadata: { path: ['eventId'], equals: event.id },
      },
    });
  assert.equal(await countAlerts(), 3);
  await request(admin, '/finance/contracts', 'POST', {
    clientId: company.id,
    number: `QA-SEM-AUD-${runId}`,
    title: 'Acompanhamento fictício QA',
    feeModel: 'FIXED',
    fixedAmount: '100.00',
    serviceNames: ['Acompanhamento em delegacia'],
  });
  assert.equal(await prisma.calendarEvent.count({ where: { organizationId: orgA } }), 1);
  verified(
    'Catálogo, parcelas exatas, contrato vinculado e audiência transacional; acompanhamento sem audiência',
  );
  recordJourney('contratos_financeiro', 'PARTIAL', financeEvidenceStart);

  stage = 'documentos e Storage privado';
  let generated: DocumentSnapshot | undefined;
  let generationFailure: string | undefined;
  let internalTestDocumentId: string | undefined;
  const documentExpiryFailures: Array<{ stage: string; message: string }> = [];
  const documentEvidenceStart = checks.length;
  try {
    await request(admin, '/documents/office-settings', 'PATCH', {
      attorneyName: 'Profissional fictício QA',
      professionalRegistration: 'OAB/QA 00000',
      officeAddress: 'Endereço fictício QA, 10, São Luís/MA',
      jurisdiction: 'São Luís/MA',
    });
    try {
      for (const category of ['CONTRATO_HONORARIOS', 'PROCURACAO', 'HIPOSSUFICIENCIA']) {
        stage = `documentos: geração ${category}`;
        const document = await request<DocumentSnapshot>(admin, '/documents/generate', 'POST', {
          clientId: person.id,
          category,
          ...(category === 'CONTRATO_HONORARIOS' ? { contractId: contract.id } : {}),
        });
        generated = document;
        assert.equal(document.currentVersion, 2, `${category}: PDF deveria ser a versão atual 2.`);
        await verifyDocumentHistory(
          admin,
          document.id,
          [
            {
              version: 1,
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
            { version: 2, mimeType: 'application/pdf' },
          ],
          documentExpiryFailures,
        );
      }
      assert.ok(generated, 'Nenhum documento sintético foi gerado.');

      stage = 'documentos: nova emissão e preservação do histórico';
      await request(admin, '/documents/generate', 'POST', {
        clientId: person.id,
        category: 'HIPOSSUFICIENCIA',
      });
      generated = await request<DocumentSnapshot>(admin, `/documents/${generated.id}`);
      assert.equal(generated.currentVersion, 4, 'A nova emissão deveria acrescentar duas versões.');
      await verifyDocumentHistory(
        admin,
        generated.id,
        [
          {
            version: 1,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
          { version: 2, mimeType: 'application/pdf' },
          {
            version: 3,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
          { version: 4, mimeType: 'application/pdf' },
        ],
        documentExpiryFailures,
      );

      stage = 'documentos: geração para pessoa jurídica';
      const companyDocument = await request<DocumentSnapshot>(
        admin,
        '/documents/generate',
        'POST',
        {
          clientId: company.id,
          category: 'PROCURACAO',
        },
      );
      assert.equal(companyDocument.currentVersion, 2);
      await verifyDocumentHistory(
        admin,
        companyDocument.id,
        [
          {
            version: 1,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
          { version: 2, mimeType: 'application/pdf' },
        ],
        documentExpiryFailures,
      );
    } catch (error) {
      generationFailure = safeErrorMessage(error);
      checks.push(
        `Geração DOCX/PDF indisponível com dados pessoais sintéticos sem CPF/CNPJ: ${generationFailure}`,
      );
      console.error(`QA documentos_assinatura: PARTIAL na etapa "${stage}": ${generationFailure}`);
    }

    stage = 'documentos: upload e versão enviada';
    const syntheticWord = await syntheticDocx(`Documento DOCX sintético QA ${runId}`);
    const uploadedDocument = await uploadDocument(
      admin,
      {
        title: `Upload sintético QA ${runId}`,
        category: 'ANEXO_QA',
        visibility: 'INTERNAL',
        clientId: person.id,
      },
      syntheticWord,
      'qa-sintetico.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    internalTestDocumentId = uploadedDocument.id;
    await verifyDocumentHistory(
      admin,
      uploadedDocument.id,
      [
        {
          version: 1,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      ],
      documentExpiryFailures,
    );
    await uploadDocumentVersion(
      admin,
      uploadedDocument.id,
      await syntheticPdf(`Versão PDF sintética QA ${runId}`),
      'qa-sintetico-v2.pdf',
      'application/pdf',
    );
    await verifyDocumentHistory(
      admin,
      uploadedDocument.id,
      [
        {
          version: 1,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
        { version: 2, mimeType: 'application/pdf' },
      ],
      documentExpiryFailures,
    );

    const signingDocument =
      generated ?? (await request<DocumentSnapshot>(admin, `/documents/${uploadedDocument.id}`));

    stage = 'documentos: solicitação, falha recuperável e assinatura sintética';
    const signingRequest = await request<{
      id: string;
      token: string;
      expiresAt: string;
      signerName: string;
    }>(admin, `/documents/${signingDocument.id}/signature-requests`, 'POST', {
      signerName: 'Pessoa sintética QA',
      expiresInDays: 2,
    });
    assert.match(signingRequest.token, /^[a-f0-9]{64}$/);
    const persistedSigningRequest = await prisma.documentSigningRequest.findUniqueOrThrow({
      where: { id: signingRequest.id },
    });
    assert.equal(
      persistedSigningRequest.tokenHash,
      createHash('sha256').update(signingRequest.token).digest('hex'),
      'O token de assinatura deveria estar persistido somente como hash.',
    );
    assert.ok(new Date(signingRequest.expiresAt).getTime() > Date.now());
    assert.ok(new Date(signingRequest.expiresAt).getTime() <= Date.now() + 2 * 24 * 60 * 60 * 1000);
    const signatureImage = syntheticSignaturePng();
    const signatureInput = {
      signerName: 'Pessoa sintética QA',
      consent: true,
      signature: `data:image/png;base64,${signatureImage.toString('base64')}`,
    };
    const publicDetails = await publicSignatureRequest<{
      status: string;
      sourceVersion: number;
      sourceSha256: string;
      documentUrl: string;
    }>(signingRequest.token, 'details');
    assert.equal(publicDetails.status, 'PENDING');
    assert.equal(publicDetails.sourceVersion, signingDocument.currentVersion);
    const sourceVersion = await prisma.documentVersion.findFirstOrThrow({
      where: { documentId: signingDocument.id, version: signingDocument.currentVersion },
    });
    assert.equal(publicDetails.sourceSha256, sourceVersion.sha256);
    const publicDocumentUrl = new URL(publicDetails.documentUrl);
    assert.equal(publicDocumentUrl.origin, new URL(supabaseUrl).origin);
    const publicUrlToken = publicDocumentUrl.searchParams.get('token');
    assert.ok(publicUrlToken, 'A visualização pública não retornou URL assinada.');
    const { exp: publicUrlExpiry, iat: publicUrlIssuedAt } = signedUrlClaims(publicUrlToken);
    const publicUrlNow = Math.floor(Date.now() / 1000);
    const publicUrlTtlSeconds = publicUrlExpiry - publicUrlIssuedAt;
    if (publicUrlExpiry <= publicUrlNow || publicUrlTtlSeconds !== 300)
      documentExpiryFailures.push({
        stage: 'documentos: URL assinada pública para assinatura',
        message: `JWT exp=${publicUrlExpiry}, iat=${publicUrlIssuedAt}, TTL=${publicUrlTtlSeconds}s; TTL esperado é 300s.`,
      });
    const publicPdfResponse = await fetch(publicDetails.documentUrl);
    assert.equal(publicPdfResponse.status, 200);
    const publicPdf = Buffer.from(await publicPdfResponse.arrayBuffer());
    assert.equal(createHash('sha256').update(publicPdf).digest('hex'), sourceVersion.sha256);
    await publicSignatureRequest(
      signingRequest.token,
      'sign',
      { ...signatureInput, signerName: 'Nome incorreto sintético' },
      400,
    );
    assert.equal(
      (await prisma.documentSigningRequest.findUniqueOrThrow({ where: { id: signingRequest.id } }))
        .status,
      'PENDING',
      'Falha de validação deveria deixar o pedido pendente para nova tentativa.',
    );
    const signedResult = await publicSignatureRequest<{
      status: string;
      signedDocumentId: string;
    }>(signingRequest.token, 'sign', signatureInput, 201);
    assert.equal(signedResult.status, 'SIGNED');
    const completedSigning = await prisma.documentSigningRequest.findUniqueOrThrow({
      where: { id: signingRequest.id },
    });
    assert.equal(completedSigning.status, 'SIGNED');
    assert.ok(completedSigning.signatureSha256);
    const signedDocument = await request<DocumentSnapshot>(
      admin,
      `/documents/${signedResult.signedDocumentId}`,
    );
    assert.equal(signedDocument.visibility, 'INTERNAL');
    await verifyDocumentHistory(
      admin,
      signedDocument.id,
      [{ version: 1, mimeType: 'application/pdf' }],
      documentExpiryFailures,
    );
    await publicSignatureRequest(signingRequest.token, 'sign', signatureInput, 410);

    stage = 'documentos: revogação e rejeição do link revogado';
    const revokeRequest = await request<{ id: string; token: string }>(
      admin,
      `/documents/${signingDocument.id}/signature-requests`,
      'POST',
      { signerName: 'Pessoa sintética QA', expiresInDays: 2 },
    );
    await request(admin, `/documents/signature-requests/${revokeRequest.id}/revoke`, 'POST');
    assert.equal(
      (await prisma.documentSigningRequest.findUniqueOrThrow({ where: { id: revokeRequest.id } }))
        .status,
      'REVOKED',
    );
    await publicSignatureRequest(revokeRequest.token, 'details', undefined, 410);

    const documentCheckSummary = `${generationFailure ? 'Geração DOCX/PDF condicionada a CPF/CNPJ' : 'Geração DOCX/PDF'}; upload DOCX/PDF, hash, assinatura sintética, recuperação após falha e revogação`;
    if (documentExpiryFailures.length) {
      checks.push(
        `${documentCheckSummary}; ${documentExpiryFailures.length} falha(s) de expiração de URL assinada.`,
      );
      const firstFailure = documentExpiryFailures[0]!;
      journeys.documentos_assinatura = {
        status: 'FAIL',
        stage: firstFailure.stage,
        evidence: checks.slice(documentEvidenceStart),
        error: documentExpiryFailures
          .map(({ stage: failedStage, message }) => `${failedStage}: ${message}`)
          .join(' | '),
      };
      process.exitCode = 1;
    } else {
      verified(`${documentCheckSummary}; expiração das URLs dentro do TTL declarado.`);
      recordJourney(
        'documentos_assinatura',
        generationFailure ? 'PARTIAL' : 'PASS',
        documentEvidenceStart,
      );
    }
  } catch (error) {
    const message = [
      safeErrorMessage(error),
      ...documentExpiryFailures.map(
        ({ stage: failedStage, message: failure }) => `${failedStage}: ${failure}`,
      ),
    ].join(' | ');
    recordJourney('documentos_assinatura', 'FAIL', documentEvidenceStart, new Error(message));
  }

  const financePaymentEvidenceStart = checks.length;
  const financeJourneyEvidence = () => [
    ...checks.slice(financeEvidenceStart, documentEvidenceStart),
    ...checks.slice(financePaymentEvidenceStart),
  ];
  const financeFailures: Array<{ stage: string; message: string }> = [];
  try {
    stage = 'financeiro: rejeição de pagamento acima do saldo';
    const installmentId = receivable.installments[0]!.id;
    const paymentBody = {
      clientId: person.id,
      reference: `PG-QA-${runId}`,
      amount: '100.00',
      paidAt: issueDate,
      method: 'PIX',
      allocations: [{ installmentId, amount: '100.00' }],
    };
    await request(
      admin,
      '/finance/payments',
      'POST',
      {
        ...paymentBody,
        reference: `PG-EXCESSO-${runId}`,
        amount: '400.00',
        allocations: [{ installmentId, amount: '400.00' }],
      },
      400,
    );
    const idempotency = { 'Idempotency-Key': randomUUID() };
    stage = 'financeiro: pagamento parcial concorrente e idempotência';
    const [payment, concurrentRepeat] = await Promise.all([
      request<{ payment: Entity }>(
        admin,
        '/finance/payments',
        'POST',
        paymentBody,
        201,
        idempotency,
      ),
      request<{ payment: Entity }>(
        admin,
        '/finance/payments',
        'POST',
        paymentBody,
        201,
        idempotency,
      ),
    ]);
    assert.equal(payment.payment.id, concurrentRepeat.payment.id);
    const repeated = await request<{ payment: Entity }>(
      admin,
      '/finance/payments',
      'POST',
      paymentBody,
      201,
      idempotency,
    );
    assert.equal(payment.payment.id, repeated.payment.id);
    assert.equal(
      (
        await prisma.payment.findUniqueOrThrow({ where: { id: payment.payment.id } })
      ).amount.toString(),
      '100',
      'Pagamento parcial deve persistir sem arredondamento em ponto flutuante.',
    );
    stage = 'financeiro: saldo após pagamento parcial';
    try {
      const partialBalance = await request<{
        financial: { outstanding: Array<{ currency: string; amount: string }> };
      }>(admin, `/clients/${person.id}/overview`);
      assert.equal(
        partialBalance.financial.outstanding.find((item) => item.currency === 'BRL')?.amount,
        '900.0000',
      );
    } catch (error) {
      financeFailures.push({ stage, message: safeErrorMessage(error) });
      console.error(
        `QA contratos_financeiro: FAIL na etapa "${stage}": ${safeErrorMessage(error)}`,
      );
    }
    await request(outsider, `/finance/receivables/${receivable.id}`, 'GET', undefined, 404);

    stage = 'financeiro: solicitação e aprovação de correção';
    const proposal = await request<{ request: Entity; applied: boolean }>(
      finance,
      `/finance/payments/${payment.payment.id}/change-requests`,
      'PATCH',
      {
        reference: paymentBody.reference,
        amount: '120.00',
        paidAt: issueDate,
        method: 'PIX',
        allocations: [{ installmentId, amount: '120.00' }],
        reason: 'Correção fictícia QA',
      },
    );
    assert.equal(proposal.applied, false);
    assert.equal(
      (
        await prisma.payment.findUniqueOrThrow({ where: { id: payment.payment.id } })
      ).amount.toString(),
      '100',
    );
    assert.equal(
      await prisma.notification.count({
        where: {
          organizationId: orgA,
          userId: admin.userId,
          metadata: { path: ['requestId'], equals: proposal.request.id },
        },
      }),
      1,
    );
    await request(
      finance,
      `/finance/payments/change-requests/${proposal.request.id}/approve`,
      'POST',
      undefined,
      403,
    );
    await request(
      admin,
      `/finance/payments/change-requests/${proposal.request.id}/approve`,
      'POST',
    );
    await request(
      admin,
      `/finance/payments/change-requests/${proposal.request.id}/approve`,
      'POST',
      undefined,
      409,
    );
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.payment.id } })).status,
      'REVERSED',
    );
    stage = 'financeiro: saldo após correção aprovada';
    try {
      const overview = await request<{
        financial: { outstanding: Array<{ currency: string; amount: string }> };
      }>(admin, `/clients/${person.id}/overview`);
      assert.equal(
        overview.financial.outstanding.find((item) => item.currency === 'BRL')?.amount,
        '880.0000',
      );
    } catch (error) {
      financeFailures.push({ stage, message: safeErrorMessage(error) });
      console.error(
        `QA contratos_financeiro: FAIL na etapa "${stage}": ${safeErrorMessage(error)}`,
      );
    }
    stage = 'financeiro: relatórios e isolamento de permissões';
    const exportPath =
      '/reports/receivables-due/export.csv?from=2026-01-01&to=2030-01-01&groupBy=month';
    const reportCsv = await request<string>(admin, exportPath);
    assert.ok(reportCsv.includes('"880.00"'), 'Relatório não retornou o saldo agregado esperado.');
    await request(finance, exportPath, 'GET', undefined, 403);
    if (financeFailures.length) {
      checks.push(
        'Pagamento parcial exato, concorrência/idempotência, excesso rejeitado, correção/aprovação, relatório e isolamento passaram; overview de saldo falhou.',
      );
      journeys.contratos_financeiro = {
        status: 'FAIL',
        stage: financeFailures[0]!.stage,
        evidence: financeJourneyEvidence(),
        error: financeFailures
          .map(({ stage: failedStage, message }) => `${failedStage}: ${message}`)
          .join(' | '),
      };
      process.exitCode = 1;
    } else {
      verified(
        'Pagamento parcial exato, concorrência/idempotência, excesso rejeitado, saldo, correção/aprovação, relatório e isolamento',
      );
      recordJourney('contratos_financeiro', 'PASS', financeJourneyEvidence());
    }
  } catch (error) {
    recordJourney('contratos_financeiro', 'FAIL', financeJourneyEvidence(), error);
  }

  const portalEvidenceStart = checks.length;
  try {
    stage = 'portal: identidade sintética e vínculo explícito clientId';
    const portal = await account(orgA, 'client', person.id);
    const ownVisibleDocument = await uploadDocument(
      admin,
      {
        title: `Documento visível ao cliente QA ${runId}`,
        category: 'ANEXO_QA',
        visibility: 'CLIENT',
        clientId: person.id,
      },
      await syntheticPdf(`PDF visível ao cliente sintético QA ${runId}`),
      'qa-visivel.pdf',
      'application/pdf',
    );
    const otherVisibleDocument = await uploadDocument(
      admin,
      {
        title: `Documento de outro cliente QA ${runId}`,
        category: 'ANEXO_QA',
        visibility: 'CLIENT',
        clientId: company.id,
      },
      await syntheticPdf(`PDF de outro cliente sintético QA ${runId}`),
      'qa-outro-cliente.pdf',
      'application/pdf',
    );
    await request(portal, `/clients/${company.id}/overview`, 'GET', undefined, 404);
    if (internalTestDocumentId)
      await request(
        portal,
        `/documents/${internalTestDocumentId}/download-url`,
        'GET',
        undefined,
        404,
      );
    await request(
      portal,
      `/documents/${otherVisibleDocument.id}/download-url`,
      'GET',
      undefined,
      404,
    );
    const visibleDocumentUrl = await request<{ url: string }>(
      portal,
      `/documents/${ownVisibleDocument.id}/download-url`,
    );
    assert.equal((await fetch(visibleDocumentUrl.url)).status, 200);
    const ownDocuments = await request<Page>(portal, `/documents?clientId=${person.id}`);
    assert.ok(ownDocuments.items.some(({ id }) => id === ownVisibleDocument.id));
    assert.ok(ownDocuments.items.every(({ clientId }) => clientId === person.id));
    await request(portal, `/internal-notes?clientId=${person.id}`, 'GET', undefined, 403);
    await request(portal, '/audit-logs', 'GET', undefined, 403);
    await request(portal, '/admin/users', 'GET', undefined, 403);
    await request(portal, '/finance/expenses', 'GET', undefined, 403);

    stage = 'portal: mensagens, notificações e dados financeiros vinculados';
    const sentMessage = await request<Entity>(admin, '/client-messages', 'POST', {
      clientId: person.id,
      matterId: matter.id,
      body: 'Mensagem sintética de validação do portal.',
    });
    const ownMessages = await request<Array<Entity & { clientId: string }>>(
      portal,
      `/client-messages?clientId=${person.id}`,
    );
    assert.ok(ownMessages.some(({ id }) => id === sentMessage.id));
    const companyMessages = await request<Array<Entity & { clientId: string }>>(
      portal,
      `/client-messages?clientId=${company.id}`,
    );
    assert.ok(companyMessages.every(({ clientId }) => clientId === person.id));
    const ownNotification = await prisma.notification.create({
      data: {
        organizationId: orgA,
        userId: portal.userId,
        channel: 'IN_APP',
        status: 'SENT',
        title: 'Notificação sintética QA',
        body: 'Fixture de teste do portal.',
        sentAt: new Date(),
      },
    });
    const adminNotification = await prisma.notification.create({
      data: {
        organizationId: orgA,
        userId: admin.userId,
        channel: 'IN_APP',
        status: 'SENT',
        title: 'Notificação interna sintética QA',
        body: 'Fixture privada de teste.',
        sentAt: new Date(),
      },
    });
    const portalNotifications = await request<{ items: Entity[] }>(portal, '/notifications');
    assert.ok(portalNotifications.items.some(({ id }) => id === ownNotification.id));
    assert.ok(portalNotifications.items.every(({ id }) => id !== adminNotification.id));
    await request(portal, `/notifications/${ownNotification.id}/read`, 'PATCH');
    assert.equal(
      (await prisma.notification.findUniqueOrThrow({ where: { id: ownNotification.id } })).status,
      'READ',
    );
    const direct = createClient(supabaseUrl, required('SUPABASE_ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${portal.token}` } },
    });
    const visibleClients = await direct.from('clients').select('id');
    assert.ifError(visibleClients.error);
    assert.ok(visibleClients.data?.some((item) => item.id === person.id));
    assert.ok(visibleClients.data?.every((item) => item.id === person.id));
    const otherOrganizationClient = await createClient(supabaseUrl, required('SUPABASE_ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${outsider.token}` } },
    })
      .from('clients')
      .select('id')
      .eq('id', person.id);
    assert.ifError(otherOrganizationClient.error);
    assert.equal(
      otherOrganizationClient.data?.length,
      0,
      'RLS permitiu leitura entre organizações.',
    );
    const visibleContacts = await direct.from('client_contacts').select('client_id');
    assert.ifError(visibleContacts.error);
    assert.ok(visibleContacts.data?.every((item) => item.client_id === person.id));
    const visibleDocuments = await direct
      .from('documents')
      .select('id,client_id,visibility')
      .eq('visibility', 'CLIENT');
    assert.ifError(visibleDocuments.error);
    assert.ok(visibleDocuments.data?.some((item) => item.id === ownVisibleDocument.id));
    assert.ok(visibleDocuments.data?.every((item) => item.client_id === person.id));
    const visibleReceivables = await direct.from('receivables').select('id,client_id');
    assert.ifError(visibleReceivables.error);
    assert.ok(visibleReceivables.data?.some((item) => item.id === receivable.id));
    assert.ok(visibleReceivables.data?.every((item) => item.client_id === person.id));
    const visiblePayments = await direct.from('payments').select('id,client_id');
    assert.ifError(visiblePayments.error);
    assert.ok(visiblePayments.data?.every((item) => item.client_id === person.id));
    const syntheticPayment = await prisma.payment.findFirst({
      where: { organizationId: orgA, clientId: person.id },
      select: { id: true },
    });
    if (syntheticPayment)
      assert.ok(visiblePayments.data?.some((item) => item.id === syntheticPayment.id));
    const visibleNotifications = await direct.from('notifications').select('id,user_id');
    assert.ifError(visibleNotifications.error);
    assert.ok(visibleNotifications.data?.some((item) => item.id === ownNotification.id));
    assert.ok(visibleNotifications.data?.every((item) => item.user_id === portal.userId));

    stage = 'portal: políticas RLS de mensagens e notificações';
    const foreignMessage = await direct.from('client_messages').insert({
      id: randomUUID(),
      organization_id: orgA,
      client_id: company.id,
      body: 'Mensagem sintética não autorizada.',
      created_by_id: portal.userId,
    });
    assert.ok(foreignMessage.error, 'O portal não pode publicar no cadastro de outro cliente.');
    const ownMessage = await direct.from('client_messages').insert({
      id: randomUUID(),
      organization_id: orgA,
      client_id: person.id,
      body: 'Mensagem sintética autorizada.',
      created_by_id: portal.userId,
    });
    assert.ifError(ownMessage.error);
    const foreignNotificationUpdate = await direct
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', adminNotification.id)
      .select('id');
    assert.ifError(foreignNotificationUpdate.error);
    assert.equal(foreignNotificationUpdate.data?.length, 0);
    assert.equal(
      (await prisma.notification.findUniqueOrThrow({ where: { id: adminNotification.id } })).readAt,
      null,
    );
    await request(portal, '/reports/receivables-due', 'GET', undefined, 403);
    verified(
      'Portal vinculado por clientId, documentos visíveis, mensagens/notificações próprias e finanças/RLS isoladas',
    );
    recordJourney('portal_cliente', 'PASS', portalEvidenceStart);
    if (
      journeys.documentos_assinatura?.status === 'PARTIAL' &&
      generationFailure === undefined &&
      documentExpiryFailures.length === 0
    ) {
      journeys.documentos_assinatura.status = 'PASS';
      journeys.documentos_assinatura.evidence.push(
        'Visibilidade CLIENT e bloqueio de documento de outro cliente validados no portal.',
      );
    }
  } catch (error) {
    recordJourney('portal_cliente', 'FAIL', portalEvidenceStart, error);
  }

  const workEvidenceStart = checks.length;
  try {
    stage = 'tarefas: criação, atribuição e lembrete';
    const task = await request<Entity>(admin, '/tasks', 'POST', {
      clientId: person.id,
      matterId: matter.id,
      title: `Tarefa sintética QA ${runId}`,
      assigneeId: lawyer.userId,
      dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
    await request(lawyer, `/tasks/${task.id}`, 'PATCH', { status: 'IN_PROGRESS' });
    await request(lawyer, `/tasks/${task.id}/comments`, 'POST', {
      body: 'Histórico sintético de tarefa.',
    });
    await request(lawyer, `/tasks/${task.id}/reminders`, 'POST', {
      remindAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const listedTasks = await request<Entity[]>(lawyer, '/tasks');
    assert.ok(listedTasks.some(({ id }) => id === task.id));
    await request(lawyer, '/notifications/reconcile', 'POST');
    assert.equal(
      await prisma.taskReminder.count({ where: { taskId: task.id, status: 'SENT' } }),
      1,
      'O lembrete vencido não foi processado pelo dispatch interno.',
    );
    assert.equal(
      await prisma.notification.count({
        where: {
          organizationId: orgA,
          userId: lawyer.userId,
          metadata: { path: ['taskId'], equals: task.id },
        },
      }),
      1,
      'O dispatch interno não criou a notificação do lembrete.',
    );
    await request(lawyer, `/tasks/${task.id}`, 'PATCH', { status: 'COMPLETED' });
    const taskHistory = await prisma.taskHistory.findMany({
      where: { organizationId: orgA, taskId: task.id },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    });
    assert.deepEqual(
      taskHistory.map(({ action }) => action),
      ['CREATE', 'UPDATE', 'COMMENT', 'UPDATE'],
    );
    assert.equal(await prisma.taskComment.count({ where: { taskId: task.id } }), 1);
    assert.equal(await prisma.taskReminder.count({ where: { taskId: task.id } }), 1);

    stage = 'agenda: reagendamento e cancelamento de audiência';
    const nextStart = new Date(event.startsAt.getTime() + 24 * 60 * 60_000);
    await request(admin, `/calendar-events/${event.id}`, 'PATCH', {
      startsAt: nextStart.toISOString(),
      endsAt: new Date(nextStart.getTime() + 60 * 60_000).toISOString(),
      reminderMinutes: [120, 15],
    });
    const rescheduledEvent = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    assert.equal(rescheduledEvent.startsAt.toISOString(), nextStart.toISOString());
    assert.equal(await countAlerts(), 2);
    await request(admin, `/calendar-events/${event.id}`, 'PATCH', { status: 'CANCELLED' });
    assert.equal(await countAlerts(), 0);
    await request(admin, `/calendar-events/${event.id}`, 'PATCH', {
      status: 'SCHEDULED',
      reminderMinutes: [120, 15],
    });
    assert.equal(await countAlerts(), 2);

    stage = 'agenda: entrega interna e auditoria de acesso';
    const due = await prisma.notification.findFirstOrThrow({
      where: {
        organizationId: orgA,
        status: 'PENDING',
        metadata: { path: ['eventId'], equals: event.id },
      },
    });
    await request(admin, `/notifications/${due.id}/read`, 'PATCH', undefined, 404);
    await prisma.notification.update({
      where: { id: due.id },
      data: { scheduledAt: new Date(Date.now() - 1000) },
    });
    await request(admin, '/notifications/reconcile', 'POST');
    assert.equal(
      (await prisma.notification.findUniqueOrThrow({ where: { id: due.id } })).status,
      'SENT',
    );
    await request(admin, '/notifications/reconcile', 'POST');
    assert.equal(await countAlerts(), 1);
    await request(admin, '/auth/access', 'POST');
    await request(admin, '/auth/access', 'POST');
    assert.equal(
      await prisma.activityEvent.count({
        where: { organizationId: orgA, actorUserId: admin.userId, type: 'SYSTEM_ACCESS' },
      }),
      1,
    );
    await request(admin, '/audit-logs');
    verified(
      'Tarefa atribuída/concluída com histórico, lembrete e audiência reagendada/cancelada; dispatch manual idempotente',
    );
    const latestCronRun = preflightSnapshot?.schedulerRuns[0];
    const state = preflightSnapshot?.schedulerState;
    const lastCompletedAt = state?.lastCompletedAt;
    const lastFailedAt = state?.lastFailedAt;
    const schedulerVerified =
      preflightSnapshot?.schedulerJobs.some(
        ({ jobName, active }) => jobName === 'livio-notifications' && active,
      ) === true &&
      latestCronRun?.status === 'succeeded' &&
      latestCronRun.completedAt !== null &&
      lastCompletedAt instanceof Date &&
      (!lastFailedAt || lastCompletedAt > lastFailedAt);
    recordJourney('tarefas_agenda', schedulerVerified ? 'PASS' : 'PARTIAL', workEvidenceStart);
    journeys.tarefas_agenda?.evidence.push(
      schedulerVerified
        ? 'pg_cron ativo e execução recente concluída com sucesso.'
        : 'Estado do scheduler não comprovado como ativo e saudável no preflight.',
    );
  } catch (error) {
    recordJourney('tarefas_agenda', 'FAIL', workEvidenceStart, error);
  }
}

async function main() {
  let preflightPassed = false;
  let organizationCleanup = 'not-required';
  let authCleanupCount = 0;
  let cleanupError: string | undefined;
  try {
    stage = 'preflight: identificação dos destinos e autorização de escrita';
    preflightSnapshot = await preflight();
    preflightPassed = true;
    if (!preflightSnapshot.writeAuthorized)
      throw new Error(
        'Preflight confirmou os destinos, mas não autorizou escrita remota: projeto ausente da allowlist versionada ou sem separação independente da produção.',
      );
    await run();
  } catch (error) {
    console.error(
      `QA ${preflightPassed ? 'falhou' : 'bloqueado'} na etapa "${stage}": ${safeErrorMessage(error)}`,
    );
    process.exitCode = 1;
    const status: JourneyStatus = 'BLOCKED';
    for (const journey of [
      'clientes_processos',
      'contratos_financeiro',
      'despesas',
      'documentos_assinatura',
      'tarefas_agenda',
      'portal_cliente',
    ]) {
      if (!journeys[journey])
        journeys[journey] = {
          status,
          stage,
          evidence: [],
          error: safeErrorMessage(error),
        };
    }
  } finally {
    try {
      if (organizations.length) {
        await prisma.organizationMember.updateMany({
          where: { organizationId: { in: organizations } },
          data: { status: 'SUSPENDED' },
        });
        await prisma.organization.updateMany({
          where: { id: { in: organizations }, slug: { startsWith: `qa-workflows-${runId}-` } },
          data: { status: 'ARCHIVED' },
        });
        const [activeMemberships, activeOrganizations] = await Promise.all([
          prisma.organizationMember.count({
            where: { organizationId: { in: organizations }, status: 'ACTIVE' },
          }),
          prisma.organization.count({
            where: {
              id: { in: organizations },
              slug: { startsWith: `qa-workflows-${runId}-` },
              status: { not: 'ARCHIVED' },
            },
          }),
        ]);
        if (activeMemberships > 0 || activeOrganizations > 0) {
          cleanupError =
            activeMemberships > 0
              ? 'Ainda há memberships QA ativas.'
              : 'Ainda há organizações QA não arquivadas.';
          console.error(`QA cleanup de organizações incompleto: ${cleanupError}`);
          process.exitCode = 1;
          organizationCleanup = 'incomplete';
        } else {
          organizationCleanup = 'memberships-suspended-and-organizations-archived';
        }
      }
    } catch (error) {
      cleanupError = safeErrorMessage(error);
      console.error(`QA cleanup de organizações falhou: ${cleanupError}`);
      process.exitCode = 1;
    }
    for (const id of authUsers) {
      try {
        const banned = await authAdmin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
        if (banned.error) {
          cleanupError = safeErrorMessage(banned.error);
          console.error('QA: falha ao desativar uma identidade sintética.');
          process.exitCode = 1;
        } else {
          authCleanupCount += 1;
        }
      } catch (error) {
        cleanupError = safeErrorMessage(error);
        console.error('QA: falha ao desativar uma identidade sintética.');
        process.exitCode = 1;
      }
    }
    apiProcess?.kill();
    apiLog?.end();
    try {
      await prisma.$disconnect();
    } catch {
      cleanupError ??= 'Falha ao encerrar a conexão PostgreSQL.';
      process.exitCode = 1;
    }
    for (const journey of [
      'clientes_processos',
      'contratos_financeiro',
      'despesas',
      'documentos_assinatura',
      'tarefas_agenda',
      'portal_cliente',
    ]) {
      journeys[journey] ??= {
        status: 'NOT_RUN',
        stage: 'não alcançada',
        evidence: [],
      };
    }
    const statuses = Object.values(journeys).map(({ status }) => status);
    const success = statuses.every((status) => status === 'PASS');
    const overallStatus = statuses.includes('FAIL')
      ? 'FAIL'
      : statuses.includes('BLOCKED')
        ? 'BLOCKED'
        : success
          ? 'PASS'
          : 'PARTIAL';
    if (!success) process.exitCode = 1;
    writeFileSync(
      `test-results/qa-workflows-${runId}.json`,
      JSON.stringify(
        {
          runId,
          success,
          overallStatus,
          lastStage: stage,
          checks,
          journeys,
          preflight: preflightSnapshot
            ? {
                writeAuthorized: preflightSnapshot.writeAuthorized,
                schedulerJobs: preflightSnapshot.schedulerJobs,
                schedulerRuns: preflightSnapshot.schedulerRuns,
                schedulerState: preflightSnapshot.schedulerState,
              }
            : null,
          syntheticOrganizationsCreated: organizations.length,
          syntheticAuthUsersCreated: authUsers.length,
          cleanup: {
            organizationState: organizationCleanup,
            authUsersDisabled: authCleanupCount,
            apiStopRequested: Boolean(apiProcess),
            retainedSyntheticHistoryAndStorage: organizations.length > 0,
            error: cleanupError,
          },
          limitations: [
            'Despesas não incluem aprovação ou pagamento; calendário armazena recurrenceRule sem expandir ocorrências.',
            'A confirmação manual de despacho cobre a API, mas a entrega push no sistema operacional e SMTP exigem ensaio próprio.',
            'Os registros sintéticos arquivados e objetos do Storage permanecem para evidência; o script não apaga histórico.',
            'Restauração de backup não é exercitada por este script.',
          ],
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
  }
}

async function runPreflightOnly() {
  try {
    await preflight();
  } catch (error) {
    console.error(`QA preflight falhou: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void (preflightOnly ? runPreflightOnly() : main());
