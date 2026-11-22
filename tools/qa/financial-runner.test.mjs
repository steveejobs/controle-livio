import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import {
  financialRunnerConfiguration,
  validateFinancialRunnerHost,
  sanitizeFinancialLog,
  stopOwnedApi,
  withFinancialApi,
} from './run-financial-integrity-ci.mjs';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const ts = require('typescript');
const root = process.cwd();
const valid = {
  GITHUB_ACTIONS: 'true',
  RUNNER_OS: 'Linux',
  GITHUB_RUN_ID: '12345',
  RUNNER_TEMP: tmpdir(),
  NODE_ENV: 'test',
  SUPABASE_ENVIRONMENT: 'test',
  SUPABASE_LOCAL: 'true',
  LIVIO_FINANCIAL_INTEGRATION: 'disposable',
  DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:54322/postgres',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/v1',
  SUPABASE_ANON_KEY: 'synthetic-anon',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-local-service',
  CLAMAV_HOST: '127.0.0.1',
  CLAMAV_PORT: '13310',
};
const config = (env) => financialRunnerConfiguration(env, root, 'linux', () => false);

test('financial configuration retains local services, filters credentials and never passes browser settings', () => {
  const c = config({
    ...valid,
    GITHUB_TOKEN: 'synthetic-ci-token',
    PW_TEST_CONNECT_WS_ENDPOINT: 'ws://127.0.0.1:3100/',
    VERCEL_TOKEN: 'synthetic-cloud-token',
  });
  for (const env of [c.api, c.harness]) {
    for (const key of ['GITHUB_TOKEN', 'VERCEL_TOKEN', 'PW_TEST_CONNECT_WS_ENDPOINT'])
      assert.equal(env[key], undefined);
    assert.equal(env.DATABASE_URL, valid.DATABASE_URL);
  }
  assert.equal(c.harness.SUPABASE_ENVIRONMENT, 'test');
  assert.equal(c.api.SUPABASE_ENVIRONMENT, 'staging');
  assert.equal(c.harness.LIVIO_CLAMAV_INTEGRATION_FAILURES, 'true');
});

for (const [key, value] of [
  ['GITHUB_ACTIONS', 'false'],
  ['RUNNER_OS', 'Windows'],
  ['GITHUB_RUN_ID', ''],
  ['RUNNER_TEMP', ''],
  ['NODE_ENV', 'production'],
  ['SUPABASE_ENVIRONMENT', 'production'],
  ['SUPABASE_LOCAL', 'false'],
  ['LIVIO_FINANCIAL_INTEGRATION', undefined],
  ['SUPABASE_ACCESS_TOKEN', 'synthetic-external'],
  ['SUPABASE_DB_PASSWORD', 'synthetic-external'],
  ['DATABASE_URL', 'postgresql://synthetic@hosted.invalid/postgres'],
  ['SUPABASE_URL', 'https://hosted.invalid'],
  ['SUPABASE_URL', 'http://127.0.0.1:54330'],
  ['SUPABASE_URL', 'http://user:secret@127.0.0.1:54321'],
  ['NEXT_PUBLIC_API_URL', 'http://127.0.0.1:3999/v1'],
  ['NEXT_PUBLIC_SUPABASE_URL', 'https://hosted.invalid'],
  ['SUPABASE_ANON_KEY', 'different-anon'],
  ['CLAMAV_HOST', 'hosted.invalid'],
  ['CLAMAV_PORT', '3310'],
  ['LIVIO_QA_OUTPUT', join(tmpdir(), 'outside-evidence')],
])
  test(`financial runner refuses unsafe ${key}=${value}`, () => {
    assert.throws(() => config({ ...valid, [key]: value }));
  });

test('financial runner refuses non-Linux platform, linked projects and shared .env before starting services', () => {
  assert.throws(() => financialRunnerConfiguration(valid, root, 'win32', () => false));
  for (const suffix of ['supabase/.temp/project-ref', 'apps/api/.env.local'])
    assert.throws(() =>
      financialRunnerConfiguration(valid, root, 'linux', (name) =>
        name.replaceAll('\\', '/').endsWith(suffix),
      ),
    );
});

test('initial host preflight needs no Auth credentials or database, and rejects unsafe input before npm ci', () => {
  const host = {
    GITHUB_ACTIONS: 'true',
    RUNNER_OS: 'Linux',
    GITHUB_RUN_ID: '12345',
    RUNNER_TEMP: tmpdir(),
  };
  assert.doesNotThrow(() => validateFinancialRunnerHost(host, root, 'linux', () => false));
  for (const addition of [
    { SUPABASE_ACCESS_TOKEN: 'synthetic-external' },
    { DATABASE_URL: 'postgresql://external.invalid/postgres' },
  ])
    assert.throws(() =>
      validateFinancialRunnerHost({ ...host, ...addition }, root, 'linux', () => false),
    );
  assert.throws(() =>
    validateFinancialRunnerHost(host, root, 'linux', (name) =>
      name.replaceAll('\\', '/').endsWith('apps/api/.env.production'),
    ),
  );
});

test('direct Node entry refuses a non-CI host before creating evidence or starting services', () => {
  const directory = mkdtempSync(join(tmpdir(), 'livio-financial-refused-'));
  const result = spawnSync(process.execPath, ['tools/qa/run-financial-integrity-ci.mjs'], {
    cwd: root,
    env: { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_TEMP: directory },
    windowsHide: true,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Independent financial runner failed/);
  assert.equal(existsSync(join(directory, 'livio-financial-security')), false);
});

function apiChild(ignoreTerm = false) {
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 123,
    exitCode: null,
    signalCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    signals: [],
  });
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal !== 'SIGTERM' || !ignoreTerm)
      queueMicrotask(() => {
        child.signalCode = signal;
        child.emit('close');
      });
    return true;
  };
  return child;
}

test('owned API starts before action, writes sanitized logs and stops after harness failure', async () => {
  const c = config(valid);
  c.output = mkdtempSync(join(tmpdir(), 'livio-financial-test-'));
  const child = apiChild();
  let probes = 0,
    ran = false,
    stopped = false;
  await assert.rejects(
    withFinancialApi(
      c,
      root,
      async () => {
        ran = true;
        throw new Error('synthetic harness failure');
      },
      {
        spawn: (file, args, options) => {
          assert.equal(file, process.execPath);
          assert.deepEqual(args, [join(root, 'apps/api/dist/main.js')]);
          assert.equal(options.env.PW_TEST_CONNECT_WS_ENDPOINT, undefined);
          child.stdout.write(valid.SUPABASE_SERVICE_ROLE_KEY);
          return child;
        },
        fetch: async () => ({
          status: ++probes === 1 ? 503 : 200,
          body: { cancel: async () => {} },
        }),
        pollMs: 0,
        onStopped: () => {
          stopped = true;
        },
      },
    ),
    /synthetic harness failure/,
  );
  assert(ran);
  assert(stopped);
  assert.equal(probes, 2);
  assert.deepEqual(child.signals, ['SIGTERM']);
  assert(
    !readFileSync(join(c.output, 'financial-api.log'), 'utf8').includes(
      valid.SUPABASE_SERVICE_ROLE_KEY,
    ),
  );
});

test('readiness errors and early API exit never invoke the financial harness', async () => {
  for (const mode of ['timeout', 'exited']) {
    const c = { ...config(valid), output: mkdtempSync(join(tmpdir(), 'livio-financial-test-')) };
    const child = apiChild();
    let called = false;
    await assert.rejects(
      withFinancialApi(
        c,
        root,
        async () => {
          called = true;
        },
        {
          spawn: () => child,
          fetch: async () => {
            if (mode === 'exited') child.exitCode = 1;
            return { status: 503 };
          },
          readyTimeoutMs: 10,
          pollMs: 0,
        },
      ),
    );
    assert.equal(called, false);
    if (mode === 'timeout') assert.deepEqual(child.signals, ['SIGTERM']);
  }
});

test('only owned child receives TERM/KILL; success result is preserved and closed children are untouched', async () => {
  const c = { ...config(valid), output: mkdtempSync(join(tmpdir(), 'livio-financial-test-')) };
  const child = apiChild(true);
  const result = await withFinancialApi(c, root, async () => 'success', {
    spawn: () => child,
    fetch: async () => ({ status: 200 }),
    graceMs: 1,
  });
  assert.equal(result, 'success');
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  await stopOwnedApi(child);
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
});

test('financial logs remove local credentials, bearer, database URL and query tokens', () => {
  const text = sanitizeFinancialLog(
    `${valid.DATABASE_URL} ${valid.SUPABASE_SERVICE_ROLE_KEY} Bearer synthetic-token https://local.invalid?token=synthetic-token`,
    valid,
  );
  for (const value of [valid.DATABASE_URL, valid.SUPABASE_SERVICE_ROLE_KEY, 'synthetic-token'])
    assert(!text.includes(value));
});

function namedFunction(file, name) {
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const node = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert(node, `${name} missing`);
  return node.getText(ast);
}

test('qpdf-only function fails closed on hash errors and never calls Docker or browser (controlled routing test)', async () => {
  const code = namedFunction('tools/qa/prebuilt-ci-dependencies.mjs', 'qpdf');
  const bytes = Buffer.from('synthetic routing fixture; not a Linux binary');
  const hash = createHash('sha256').update(bytes).digest('hex');
  for (const mismatch of [false, true]) {
    const calls = [],
      evidence = {};
    const qpdf = new Function(
      'fetch',
      'qpdfHash',
      'createHash',
      'state',
      'existsSync',
      'writeFileSync',
      'extractQpdf',
      'elfDependencies',
      'run',
      'spawnSync',
      'evidence',
      'exportLine',
      'process',
      'join',
      'require',
      `${code}; return qpdf;`,
    )(
      async () => ({ ok: true, arrayBuffer: async () => bytes }),
      mismatch ? 'incorrect-hash' : hash,
      createHash,
      '/isolated',
      () => false,
      () => {},
      async () => [],
      () => [{ tag: 29, value: '$ORIGIN/../lib' }],
      (file, args) => {
        calls.push([file, args]);
        assert.notEqual(file, 'docker');
        return file === 'ldd'
          ? 'libraries resolved'
          : args[0] === '--version'
            ? 'qpdf version 12.4.2\nLicense'
            : 'valid PDF';
      },
      () => ({ status: 2 }),
      evidence,
      () => {},
      { env: { GITHUB_PATH: '/isolated/path' } },
      join,
      require,
    );
    if (mismatch) {
      await assert.rejects(qpdf(), /SHA-256 mismatch/);
      assert.equal(calls.length, 0);
    } else {
      await qpdf();
      assert.equal(evidence.invalidPdfExit, 2);
      assert.equal(calls.length, 3);
    }
  }
});

test('financial job is independent and browser-free, with disposable setup and unchanged harness entry point', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/quality.yml', 'utf8'));
  assert.deepEqual(
    new Set(Object.keys(workflow.jobs)),
    new Set(['application', 'supabase-isolation', 'synthetic-restore', 'financial-security']),
  );
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const job = workflow.jobs['financial-security'];
  assert.equal(job.needs, undefined);
  const apiBuild = job.steps.findIndex((step) => step.id === 'api-build');
  const compiledSupport = job.steps.findIndex((step) =>
    step.run?.includes('financial-integrity-support.test.mjs'),
  );
  assert(
    apiBuild >= 0 && compiledSupport > apiBuild,
    'Support tests require the real compiled finance schemas.',
  );
  const preflight = job.steps.findIndex((step) => step.run?.includes('--preflight'));
  const install = job.steps.findIndex((step) => step.run === 'npm ci');
  const qpdf = job.steps.findIndex((step) =>
    step.run?.endsWith('prebuilt-ci-dependencies.mjs qpdf'),
  );
  const stack = job.steps.findIndex((step) => step.id === 'supabase-start');
  const scanner = job.steps.findIndex((step) => step.id === 'clamav-start');
  assert(preflight < install && install < apiBuild);
  assert(compiledSupport < qpdf && qpdf < stack && stack < scanner);
  assert.equal(job.steps.filter((step) => step.run === 'npm run build:api').length, 1);
  assert.equal(job.if, workflow.jobs['supabase-isolation'].if);
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  const commands = job.steps.map((step) => step.run ?? '').join('\n');
  assert(
    job.steps.findIndex((step) =>
      step.run?.endsWith('run-financial-integrity-ci.mjs --preflight'),
    ) < job.steps.findIndex((step) => step.run === 'npm ci'),
  );
  for (const forbidden of [
    'prebuilt-ci-dependencies.mjs browser',
    'playwright install',
    'run-integrated-browser-ci',
    'test:e2e',
    'PW_TEST_CONNECT',
  ])
    assert(!commands.includes(forbidden));
  for (const required of [
    'prebuilt-ci-dependencies.mjs qpdf',
    'prepare-local-supabase-ci.mjs',
    'start-clamav-ci.mjs',
    'run-financial-integrity-ci.mjs',
    'stop-clamav-ci.mjs',
  ])
    assert(commands.includes(required));
  assert(!job.steps.some((step) => step['continue-on-error']));
  const runner = readFileSync('tools/qa/run-financial-integrity-ci.mjs', 'utf8');
  assert(runner.includes('tools/qa/financial-integrity-ci.mjs'));
  for (const file of [
    'financial-integrity-ci.mjs',
    'financial-write-matrix.mjs',
    'financial-security-ci.mjs',
  ])
    assert(
      !/from ['"](?:@playwright\/test|playwright|playwright-core)['"]/.test(
        readFileSync(resolve('tools/qa', file), 'utf8'),
      ),
    );
});

test('matrix fixture makers use existing required Prisma scalar fields before real SQL controls', async (context) => {
  const { Prisma } = require('@prisma/client');
  const file = 'tools/qa/financial-write-matrix.mjs';
  const ast = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const initializers = new Map();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      ['makers', 'paymentData'].includes(node.name.text)
    )
      initializers.set(node.name.text, node.initializer.getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const delegates = new Map(
    Prisma.dmmf.datamodel.models.map((model) => [
      model.name[0].toLowerCase() + model.name.slice(1),
      model,
    ]),
  );
  const validate = (model, data) => {
    assert(model);
    assert.deepEqual(
      Object.keys(data).filter((key) => !model.fields.some((field) => field.name === key)),
      [],
      'Unknown fixture field in ' + model.name,
    );
    for (const [name, value] of Object.entries(data)) {
      const field = model.fields.find((candidate) => candidate.name === name);
      assert.notEqual(field.kind, 'object', 'Only scalar fixture input is expected');
      if (field.kind === 'enum') {
        const enumeration = Prisma.dmmf.datamodel.enums.find((item) => item.name === field.type);
        assert(
          enumeration.values.some((item) => item.name === value),
          model.name + '.' + name,
        );
      } else if (field.type === 'Decimal') {
        assert.equal(typeof value, 'string', 'Money fixture must remain decimal text');
        assert(/^-?\d+(?:\.\d+)?$/.test(value));
        assert(new Prisma.Decimal(value).isFinite());
      } else if (field.type === 'DateTime') {
        assert(value instanceof Date && Number.isFinite(value.getTime()));
      } else if (field.type === 'String') assert.equal(typeof value, 'string');
      else if (field.type === 'Int') assert(Number.isInteger(value));
      else if (field.type === 'BigInt') assert.equal(typeof value, 'bigint');
      else if (field.type === 'Boolean') assert.equal(typeof value, 'boolean');
      else if (field.type === 'Json') assert.doesNotThrow(() => JSON.stringify(value));
      else assert.fail('Unhandled fixture scalar ' + field.type);
      if (name === 'organizationId') assert.equal(value, org.organizationId);
      if (name === 'clientId') assert.equal(value, fixture.clientId);
      if (
        [
          'createdById',
          'actorUserId',
          'uploadedById',
          'submittedById',
          'confirmedById',
          'reversedById',
        ].includes(name)
      )
        assert.equal(value, owner.userId);
    }
    for (const relation of model.fields.filter((field) => field.kind === 'object')) {
      for (const [index, name] of (relation.relationFromFields ?? []).entries()) {
        if (!(name in data)) continue;
        assert.equal(relation.relationToFields[index], 'id');
        assert(
          identities.get(relation.type)?.has(data[name]),
          model.name + '.' + name + ' unknown parent',
        );
      }
    }
    assert.deepEqual(
      model.fields
        .filter(
          (field) =>
            field.kind !== 'object' &&
            field.isRequired &&
            !field.hasDefaultValue &&
            !field.isUpdatedAt &&
            data[field.name] === undefined,
        )
        .map((field) => field.name),
      [],
      'Missing fixture field in ' + model.name,
    );
  };
  // Structural regression only. The unchanged harness still validates real Prisma, FK and SQL inserts.
  const database = new Proxy(
    {},
    {
      get: (_target, key) => ({
        create: async ({ data }) => {
          validate(delegates.get(key), data);
          const row = { id: randomUUID(), ...data };
          const model = delegates.get(key);
          if (!identities.has(model.name)) identities.set(model.name, new Set());
          identities.get(model.name).add(row.id);
          return row;
        },
      }),
    },
  );
  const org = { organizationId: randomUUID() };
  const fixture = {
    clientId: randomUUID(),
    installmentId: randomUUID(),
    receivableId: randomUUID(),
  };
  const owner = { userId: randomUUID(), organizationId: org.organizationId };
  const identities = new Map([
    ['Organization', new Set([org.organizationId])],
    ['User', new Set([owner.userId])],
    ['Client', new Set([fixture.clientId])],
    ['Receivable', new Set([fixture.receivableId])],
    ['ReceivableInstallment', new Set([fixture.installmentId])],
  ]);
  const makers = new Function(
    'database',
    'org',
    'f',
    'owner',
    'now',
    'randomUUID',
    'createHash',
    'const paymentData=' +
      initializers.get('paymentData') +
      '; const makers=' +
      initializers.get('makers') +
      '; return makers;',
  )(database, org, fixture, owner, () => new Date(), randomUUID, createHash);
  assert.equal(Object.keys(makers).length, 12);
  for (const [table, maker] of Object.entries(makers))
    await context.test('fixture: ' + table, async () => {
      validate(
        Prisma.dmmf.datamodel.models.find((model) => model.dbName === table),
        await maker(),
      );
    });
});
