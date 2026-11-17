import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { copyTree } from './volume-copy.mjs';
import { delayedProvider } from './delayed-provider.mjs';
import { projectName, storageVolumeIdentity, verifyStorageVolume } from './stack-identity.mjs';
import { cleanupTarget } from './cleanup-target.mjs';
import { api as recoveryApi, assertRecoveryErrorResponse } from './transversal.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Uses the actual compiled global filter. API build is required before these
// support tests, as it is in the disposable Recovery workflow. No server/DB is
// constructed by invoking the filter with this synthetic HTTP context.
function filteredRecoveryError(status, requestPath = '/v1/storage-recovery') {
  const require = createRequire(import.meta.url);
  const { ApiExceptionFilter } = require(resolve('apps/api/dist/common/api-exception.filter.js'));
  const { HttpException } = require('@nestjs/common');
  let body;
  const response = {
    status: (code) => {
      assert.equal(code, status);
      return {
        json: (value) => {
          body = value;
        },
      };
    },
  };
  new ApiExceptionFilter().catch(new HttpException('Synthetic recovery negative', status), {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: requestPath, headers: {}, id: 'synthetic-correlation' }),
      getResponse: () => response,
    }),
  });
  return body;
}

function volumeFixture(backendPath = '/mnt') {
  const project = 'livio-recovery-123-abcdef12';
  return {
    project,
    container: {
      Id: 'b'.repeat(64),
      Name: '/supabase_storage_' + project,
      Config: {
        Labels: { 'com.supabase.cli.project': project },
        Env: ['STORAGE_BACKEND=file', 'FILE_STORAGE_BACKEND_PATH=' + backendPath],
      },
      Mounts: [
        {
          Type: 'volume',
          Name: 'supabase_storage_' + project,
          Source: '/var/lib/docker/volumes/supabase_storage_' + project + '/_data',
          Destination: backendPath,
        },
      ],
    },
  };
}
test('observed /mnt and legacy backend paths require the matching owned named volume', () => {
  for (const path of ['/mnt', '/var/lib/storage']) {
    const f = volumeFixture(path);
    assert.deepEqual(storageVolumeIdentity(f.container, f.project), {
      backendPath: path,
      volume: 'supabase_storage_' + f.project,
    });
  }
});
test('configured backend without its exact mount is denied', () => {
  const f = volumeFixture();
  f.container.Mounts[0].Destination = '/var/lib/storage';
  assert.throws(() => storageVolumeIdentity(f.container, f.project));
});
test('bind mounts and volumes belonging to another project are denied', () => {
  for (const mutation of [
    (c) => {
      c.Mounts[0].Type = 'bind';
    },
    (c) => {
      c.Mounts[0].Name = 'supabase_storage_other';
    },
  ]) {
    const f = volumeFixture();
    mutation(f.container);
    assert.throws(() => storageVolumeIdentity(f.container, f.project));
  }
});
test('backend identity requires both the exact container name and project label', () => {
  for (const mutation of [
    (c) => {
      c.Name = '/supabase_storage_other';
    },
    (c) => {
      c.Config.Labels['com.supabase.cli.project'] = 'other';
    },
  ]) {
    const f = volumeFixture();
    mutation(f.container);
    assert.throws(() => storageVolumeIdentity(f.container, f.project));
  }
});
test('unsupported paths, traversal and duplicated configuration fail closed', () => {
  for (const path of ['/mnt/../other', '/external', '/mnt/']) {
    const f = volumeFixture(path);
    assert.throws(() => storageVolumeIdentity(f.container, f.project));
  }
  const f = volumeFixture();
  f.container.Config.Env.push('FILE_STORAGE_BACKEND_PATH=/mnt');
  assert.throws(() => storageVolumeIdentity(f.container, f.project));
});
test('non-file backends and ambiguous mounts fail closed', () => {
  const f = volumeFixture();
  f.container.Config.Env[0] = 'STORAGE_BACKEND=s3';
  assert.throws(() => storageVolumeIdentity(f.container, f.project));
  const g = volumeFixture();
  g.container.Mounts.push({ ...g.container.Mounts[0] });
  assert.throws(() => storageVolumeIdentity(g.container, g.project));
});
test('cleanup uses the observed backend path and still requires verified absence', () => {
  const f = identifiedCleanup();
  const storage = f.state.containers[1];
  storage.Config.Env[1] = 'FILE_STORAGE_BACKEND_PATH=/mnt';
  storage.Mounts[0].Destination = '/mnt';
  assert.equal(cleanupTarget(f.env, f.options).backendPath, '/mnt');
  assert.equal(f.state.stops, 1);
});

const cleanupEnv = {
  GITHUB_ACTIONS: 'true',
  RUNNER_OS: 'Linux',
  GITHUB_RUN_ID: '123',
  LIVIO_STORAGE_RECOVERY: 'disposable-new-stack',
  LIVIO_IDENTITY_INTEGRATION: 'disposable',
  NODE_ENV: 'test',
  SUPABASE_LOCAL: 'true',
  SUPABASE_ENVIRONMENT: 'test',
  STORAGE_RECOVERY_DISPATCH_ENABLED: 'true',
  STORAGE_RECOVERY_DELETE_ENABLED: 'true',
  RUNNER_TEMP: '/synthetic',
  LIVIO_QA_OUTPUT: '/synthetic/output',
};
test('cleanup before stack initialization performs no operation without a destination marker', () => {
  const result = cleanupTarget(cleanupEnv, {
    platform: 'linux',
    exists: () => false,
    docker: () => {
      throw new Error('UNEXPECTED_DOCKER');
    },
  });
  assert.equal(result.status, 'NOT_EXECUTED');
});
test('a recorded destination still requires complete original endpoint guards', () => {
  assert.throws(() =>
    cleanupTarget(cleanupEnv, {
      platform: 'linux',
      exists: (p) => p.endsWith('recovery-target.json'),
      docker: () => {
        throw new Error('UNEXPECTED_DOCKER');
      },
    }),
  );
  assert.throws(() =>
    cleanupTarget(
      { ...cleanupEnv, STORAGE_RECOVERY_DELETE_ENABLED: 'false' },
      { platform: 'linux', exists: () => false },
    ),
  );
});
test('cleanup refuses another project even when loopback environment is otherwise valid', () => {
  const env = {
    ...cleanupEnv,
    NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/v1',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:54322/postgres',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon-key',
    SUPABASE_ANON_KEY: 'synthetic-anon-key',
    CLAMAV_HOST: '127.0.0.1',
    CLAMAV_PORT: '13310',
    QA_TIMINGS: 'false',
  };
  assert.throws(() =>
    cleanupTarget(env, {
      platform: 'linux',
      exists: (p) => p.endsWith('recovery-target.json'),
      read: () => JSON.stringify({ project: 'livio-legal-crm' }),
      docker: () => {
        throw new Error('UNEXPECTED_DOCKER');
      },
    }),
  );
});

function identifiedCleanup() {
  const project = 'livio-recovery-123-abcdef12',
    id = 'a'.repeat(64),
    storageId = 'b'.repeat(64);
  const env = {
    ...cleanupEnv,
    NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/v1',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:54322/postgres',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon-key',
    SUPABASE_ANON_KEY: 'synthetic-anon-key',
    CLAMAV_HOST: '127.0.0.1',
    CLAMAV_PORT: '13310',
    QA_TIMINGS: 'false',
  };
  const labels = { 'com.supabase.cli.project': project };
  const db = {
    Id: id,
    Name: '/supabase_db_' + project,
    Config: { Labels: labels },
    Mounts: [{ Type: 'volume', Name: 'supabase_db_' + project }],
    NetworkSettings: { Ports: { '5432/tcp': [{ HostPort: '54322' }] } },
  };
  const storage = {
    Id: storageId,
    Name: '/supabase_storage_' + project,
    Config: {
      Labels: labels,
      Env: ['STORAGE_BACKEND=file', 'FILE_STORAGE_BACKEND_PATH=/var/lib/storage'],
    },
    Mounts: [
      {
        Type: 'volume',
        Name: 'supabase_storage_' + project,
        Source: '/var/lib/docker/volumes/supabase_storage_' + project + '/_data',
        Destination: '/var/lib/storage',
      },
    ],
  };
  const state = {
    ids: [id, storageId],
    volumes: ['supabase_db_' + project, 'supabase_storage_' + project],
    containers: [db, storage],
    cluster: '222',
    stops: 0,
    clear: true,
  };
  const options = {
    platform: 'linux',
    exists: (p) => p.endsWith('recovery-target.json'),
    read: () => JSON.stringify({ project, sourceCluster: '111' }),
    docker: (args) => {
      if (args[0] === 'ps') return state.ids.join('\n');
      if (args[0] === 'volume' && args[1] === 'inspect')
        return JSON.stringify([
          {
            Name: 'supabase_storage_' + project,
            Driver: 'local',
            Scope: 'local',
            Options: null,
            Mountpoint: storage.Mounts[0].Source,
          },
        ]);
      if (args[0] === 'volume') return state.volumes.join('\n');
      if (args[0] === 'inspect') return JSON.stringify(state.containers);
      if (args[0] === 'exec' && args[2] === 'node') {
        const path = storage.Config.Env[1].split('=')[1];
        return JSON.stringify({
          backendPath: path,
          realPath: path,
          directory: true,
          device: '1',
          inode: '2',
        });
      }
      if (args[0] === 'exec') return state.cluster;
      throw new Error('UNEXPECTED_DOCKER_OPERATION');
    },
    stop: (name) => {
      assert.equal(name, project);
      state.stops++;
      if (state.clear) {
        state.ids = [];
        state.volumes = [];
      }
    },
  };
  return { env, options, state, project };
}
test('identified target cleanup validates cluster and volumes and verifies absence after stop', () => {
  const f = identifiedCleanup();
  const result = cleanupTarget(f.env, f.options);
  assert.equal(result.status, 'PASS');
  assert.equal(f.state.stops, 1);
  assert.equal(result.cluster, '222');
  assert.equal(result.namedProjectVolumesAfter, 0);
});
test('a marker with no containers and no named project volumes records verified absence only', () => {
  const f = identifiedCleanup();
  f.state.ids = [];
  f.state.volumes = [];
  assert.equal(cleanupTarget(f.env, f.options).status, 'ABSENT_VERIFIED');
  assert.equal(f.state.stops, 0);
});
test('partial target or residual volumes without a database identity are actionable failures', () => {
  for (const onlyVolumes of [true, false]) {
    const f = identifiedCleanup();
    if (onlyVolumes) f.state.ids = [];
    else f.state.containers = f.state.containers.filter((c) => c.Name.includes('_db_'));
    assert.throws(() => cleanupTarget(f.env, f.options));
    assert.equal(f.state.stops, 0);
  }
});
test('source cluster and foreign volume cannot be deleted as a restore destination', () => {
  const f = identifiedCleanup();
  f.state.cluster = '111';
  assert.throws(() => cleanupTarget(f.env, f.options));
  assert.equal(f.state.stops, 0);
  const g = identifiedCleanup();
  g.state.containers[1].Mounts[0].Name = 'another-project-volume';
  assert.throws(() => cleanupTarget(g.env, g.options));
  assert.equal(g.state.stops, 0);
});
test('a failed stop preserves its failure and a successful command without absence still fails', () => {
  const f = identifiedCleanup(),
    error = new Error('SYNTHETIC_STOP_FAILED');
  f.options.stop = () => {
    throw error;
  };
  assert.throws(
    () => cleanupTarget(f.env, f.options),
    (e) => e === error,
  );
  const g = identifiedCleanup();
  g.state.clear = false;
  assert.throws(
    () => cleanupTarget(g.env, g.options),
    (e) => e.code === 'RECOVERY_TARGET_CLEANUP_INCOMPLETE',
  );
});
test('remote Docker settings and escaped evidence directories fail before cleanup', () => {
  const f = identifiedCleanup();
  assert.throws(() =>
    cleanupTarget({ ...f.env, DOCKER_HOST: 'tcp://external.invalid:2375' }, f.options),
  );
  assert.throws(() => cleanupTarget({ ...f.env, LIVIO_QA_OUTPUT: '/outside' }, f.options));
  assert.equal(f.state.stops, 0);
});
test('a malformed marker never becomes proof of absence', () => {
  const f = identifiedCleanup();
  f.options.read = () => '{incomplete';
  assert.throws(() => cleanupTarget(f.env, f.options));
  assert.equal(f.state.stops, 0);
});

test('real buffered HTTP request reaches provider only after client timeout, with identical bytes', async () => {
  const expected = Buffer.from('SYNTHETIC LATE WRITE - NO LEGAL VALUE');
  let observed;
  const provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    observed = Buffer.concat(chunks);
    res.writeHead(201);
    res.end('{}');
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const url = `http://127.0.0.1:${provider.address().port}/storage/v1/object/synthetic/test`;
  const barrier = await delayedProvider(url, { timeoutMs: 150 });
  try {
    const request = barrier.request(url, { method: 'POST', body: expected });
    const rejection = assert.rejects(request, (e) =>
      ['TimeoutError', 'AbortError'].includes(e.name),
    );
    await barrier.received;
    await rejection;
    const timeout = Date.now();
    assert.equal(observed, undefined);
    barrier.release();
    const actual = await barrier.result;
    assert.equal(actual.status, 201);
    assert.ok(actual.providerCompletedAt >= timeout);
    assert.deepEqual(observed, expected);
  } finally {
    await barrier.close();
    provider.closeAllConnections();
    await new Promise((r) => provider.close(r));
  }
});
test('transport refuses external provider addresses before opening a listener', async () => {
  await assert.rejects(delayedProvider('https://external.invalid/storage/v1/object/test'));
});
test('project identity cannot select another project or a shell expression', () => {
  assert.equal(projectName({}), 'livio-legal-crm');
  assert.equal(
    projectName({ LIVIO_RECOVERY_PROJECT: 'livio-recovery-123-abcdef12' }),
    'livio-recovery-123-abcdef12',
  );
  for (const value of [
    'production',
    'other-project',
    'livio-recovery-1-zzzzzzzz',
    '../../test',
    '$(secret)',
  ])
    assert.throws(() => projectName({ LIVIO_RECOVERY_PROJECT: value }));
});
test('physical backup copier preserves nested bytes/hash and refuses overwriting destination', () => {
  const root = mkdtempSync(join(tmpdir(), 'livio-recovery-volume-unit-')),
    source = join(root, 'source'),
    destination = join(root, 'destination');
  mkdirSync(source);
  mkdirSync(destination);
  mkdirSync(join(source, 'nested'));
  writeFileSync(join(source, 'nested', 'fixture.bin'), Buffer.from([0, 255, 13, 10, 7]));
  try {
    const files = copyTree(source, destination);
    assert.equal(files.length, 1);
    assert.equal(files[0].size, 5);
    assert.deepEqual(
      readFileSync(join(destination, 'nested', 'fixture.bin')),
      readFileSync(join(source, 'nested', 'fixture.bin')),
    );
    assert.throws(() => copyTree(source, destination), /empty/);
  } finally {
    assert.equal(dirname(root), tmpdir());
    rmSync(root, { recursive: true, force: true });
  }
});

test('physical identity requires Docker volume identity and the exact real configured directory', () => {
  const f = volumeFixture();
  const volume = {
    Name: 'supabase_storage_' + f.project,
    Driver: 'local',
    Scope: 'local',
    Options: null,
    Mountpoint: f.container.Mounts[0].Source,
  };
  const physical = {
    backendPath: '/mnt',
    realPath: '/mnt',
    directory: true,
    device: '1',
    inode: '2',
  };
  const run = (args) => {
    if (args[0] === 'volume' && args[1] === 'inspect') return JSON.stringify([volume]);
    assert.equal(args[0], 'exec');
    assert.equal(args[2], 'node');
    assert.ok(!/writeFile|unlink|rmSync/.test(args[4]));
    return JSON.stringify(physical);
  };
  assert.equal(verifyStorageVolume(f.container, f.project, run).physical.directory, true);
  for (const [key, value] of [
    ['Driver', 'external'],
    ['Mountpoint', '/foreign'],
    ['Options', { device: '/external' }],
  ]) {
    const old = volume[key];
    volume[key] = value;
    assert.throws(() => verifyStorageVolume(f.container, f.project, run));
    volume[key] = old;
  }
  for (const [key, value] of [
    ['realPath', '/elsewhere'],
    ['directory', false],
    ['backendPath', '/external'],
  ]) {
    const old = physical[key];
    physical[key] = value;
    assert.throws(() => verifyStorageVolume(f.container, f.project, run));
    physical[key] = old;
  }
});
test('an extra bind or foreign volume is rejected even with a valid backend mount', () => {
  for (const mount of [
    { Type: 'bind', Destination: '/unknown' },
    { Type: 'volume', Name: 'other', Destination: '/other' },
  ]) {
    const f = volumeFixture();
    f.container.Mounts.push(mount);
    assert.throws(() => storageVolumeIdentity(f.container, f.project));
  }
});

test('REC65 advanced IPC preserves native snapshots and exact JSON evidence', async () => {
  const { fork } = await import('node:child_process');
  const { pathToFileURL } = await import('node:url');
  const { recoveryEvidence } = await import('./ipc-evidence.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'livio-rec65-ipc-'));
  const file = join(dir, 'child.mjs');
  const moduleUrl = new URL('./ipc-evidence.mjs', import.meta.url).href;
  writeFileSync(
    file,
    'import {recoveryEvidence} from ' +
      JSON.stringify(moduleUrl) +
      ';process.once("message",m=>{process.send(recoveryEvidence([],m),()=>process.disconnect())});',
  );
  const value = {
    small: 1n,
    large: 900719925474099312345n,
    nested: [
      {
        sizeBytes: 91n,
        hash: 'a'.repeat(64),
        reference: 'version',
        state: 'COMPLETE',
        audit: ['CREATE'],
      },
    ],
    normal: [null, 'text', 4],
    date: new Date('2026-01-01'),
  };
  const child = fork(pathToFileURL(file), [], {
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  try {
    const received = once(child, 'message');
    child.send(value);
    const [message] = await received;
    assert.notEqual(message.pid, process.pid);
    assert.deepEqual(message.snapshot, value);
    assert.deepEqual(recoveryEvidence([], value).snapshot, value);
    const evidence = JSON.parse(
      JSON.stringify(message, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    );
    assert.equal(evidence.snapshot.large, '900719925474099312345');
    assert.equal(evidence.snapshot.small, '1');
    assert.equal(typeof value.large, 'bigint');
    await once(child, 'exit');
    await assert.rejects(
      new Promise((resolve, reject) => child.send(value, (e) => (e ? reject(e) : resolve()))),
      /closed|channel|IPC/i,
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('REC65 child death is observable rather than a successful empty snapshot', async () => {
  const { fork } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'livio-rec65-exit-')),
    file = join(dir, 'child.cjs');
  writeFileSync(file, 'process.once("message",()=>process.exit(7))');
  const child = fork(file, [], {
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let delivered = false;
  child.on('message', () => {
    delivered = true;
  });
  const exit = once(child, 'exit');
  child.send({ sizeBytes: 123n });
  const [code] = await exit;
  assert.equal(code, 7);
  assert.equal(delivered, false);
  rmSync(dir, { recursive: true, force: true });
});

test('REC65 suspended admission remains 401 while admitted missing permission remains 403', () => {
  const source = readFileSync(new URL('./transversal.mjs', import.meta.url), 'utf8');
  const section = source.slice(
    source.indexOf("case 'REC-X10':"),
    source.indexOf("case 'REC-X12':"),
  );
  assert.deepEqual(
    [...section.matchAll(/row.http.at\(-1\).http, (\d+)/g)].map((m) => Number(m[1])),
    [400, 201, 409, 404, 401, 401, 403],
  );
  assert.ok(section.includes('suspendedBefore'));
  const guard = readFileSync(
    new URL('../../../apps/api/src/auth/authentication.guard.ts', import.meta.url),
    'utf8',
  );
  assert.ok(guard.includes("'ACTIVE'"));
  assert.ok(guard.includes('UnauthorizedException'));
});

test('REC66 actual filter six-field response and optional seventh error label are accepted', () => {
  const body = filteredRecoveryError(401);
  assert.deepEqual(Object.keys(body).sort(), [
    'code',
    'message',
    'path',
    'requestId',
    'statusCode',
    'timestamp',
  ]);
  assert.throws(
    () =>
      assert.ok(Object.keys(body).every((key) => ['statusCode', 'error', 'message'].includes(key))),
    'Reproduce the previous candidate rejection of the actual API response',
  );
  assertRecoveryErrorResponse(body, 401, body.path);
  assertRecoveryErrorResponse({ ...body, error: 'Unauthorized' }, 401, body.path);
});

for (const [status, code, label] of [
  [400, 'bad_request', 'Bad Request'],
  [401, 'unauthorized', 'Unauthorized'],
  [403, 'forbidden', 'Forbidden'],
  [404, 'not_found', 'Not Found'],
  [409, 'conflict', 'Conflict'],
])
  test(`REC66 actual API status ${status} has its own code and valid label`, () => {
    const body = filteredRecoveryError(status);
    assert.equal(body.code, code);
    assertRecoveryErrorResponse({ ...body, error: label }, status, body.path);
  });

for (const [name, patch] of [
  ['wrong HTTP status', { statusCode: 403 }],
  ['incompatible code', { code: 'forbidden' }],
  ['incompatible error label', { error: 'Forbidden' }],
  ['invalid error type', { error: { private: 'synthetic' } }],
  ['invalid requestId', { requestId: 42 }],
  ['empty requestId', { requestId: '' }],
  ['invalid timestamp', { timestamp: 'not-a-date' }],
  ['calendar-invalid timestamp', { timestamp: '2026-02-30T00:00:00.000Z' }],
  ['foreign path', { path: '/v1/clients' }],
  ['protected extra field', { documents: [{ id: 'synthetic-private' }] }],
  ['invalid message', { message: { private: 'synthetic' } }],
  ['empty message', { message: '' }],
  ['credential-bearing message', { message: 'Bearer synthetic-secret' }],
])
  test(`REC66 rejects ${name}`, () => {
    assert.throws(() =>
      assertRecoveryErrorResponse(
        { ...filteredRecoveryError(401), ...patch },
        401,
        '/v1/storage-recovery',
      ),
    );
  });

test('REC66 status alone, arrays and missing required API fields never prove a safe denial', () => {
  for (const value of [null, [], { statusCode: 401 }])
    assert.throws(() => assertRecoveryErrorResponse(value, 401, '/v1/storage-recovery'));
  for (const key of ['code', 'message', 'requestId', 'timestamp', 'path']) {
    const body = filteredRecoveryError(401);
    delete body[key];
    assert.throws(() => assertRecoveryErrorResponse(body, 401, '/v1/storage-recovery'));
  }
});

test('REC66 REC-X10 reaches later decisions and rejects any snapshot mutation (local doubles)', async () => {
  const source = readFileSync(new URL('./transversal.mjs', import.meta.url), 'utf8');
  const start = source.indexOf("case 'REC-X10': {") + "case 'REC-X10': {".length;
  const end = source.indexOf("case 'REC-X12':", start);
  const block = source.slice(start, end).replace(/\s*break;\s*}\s*$/, '');
  const run = new Function(
    'r',
    'row',
    'fixture',
    'api',
    'exhausted',
    'snapshot',
    'input',
    'org',
    'assert',
    'return (async()=>{' + block + '})()',
  );
  const own = {
      actor: {
        organizationId: 'synthetic-org',
        userId: 'synthetic-user',
        permissions: ['storage-recovery:view'],
        isAdministrator: true,
      },
      memberId: 'member',
      authToken: 'synthetic-token',
    },
    foreign = { actor: { organizationId: 'synthetic-foreign' } };
  const previousUrl = process.env.NEXT_PUBLIC_API_URL;
  const requests = [];
  let memberStatus = 'ACTIVE',
    permitted = true,
    terminalDecision = false,
    mutateOnDenial = false;
  const persisted = { generation: 0, audit: 0 };
  const server = createServer((req, res) => {
    req.resume(); // Drain the synthetic request without retaining its body.
    requests.push(req.method + ' ' + req.url);
    const number = requests.length;
    let status = 200;
    if (memberStatus === 'SUSPENDED') status = 401;
    else if (!permitted) status = 403;
    else if (req.url.includes('foreign-incident')) status = 404;
    else if (number === 2) status = 400;
    else if (number === 3) {
      status = 201;
      persisted.generation = 1;
      persisted.audit = 1;
    } else if (number === 4) status = 409;
    if (mutateOnDenial && status === 401) persisted.generation++;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(status >= 400 ? filteredRecoveryError(status, req.url) : { synthetic: true }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:' + server.address().port + '/v1';
  const r = {
    db: {
      storageUploadIntent: {
        findUniqueOrThrow: async () => ({
          generation: persisted.generation,
          state: 'RECONCILE_PENDING',
        }),
      },
      auditLog: { count: async () => persisted.audit },
      organizationMember: {
        update: async ({ data }) => {
          memberStatus = data.status;
        },
      },
      organizationMemberRole: {
        deleteMany: async () => {
          permitted = false;
        },
      },
    },
    admin: {
      overview: async () => {
        throw new Error('SYNTHETIC_AUTHORIZATION_DENIED');
      },
      decide: async () => {
        terminalDecision = true;
        throw new Error('SYNTHETIC_FOREIGN_OR_UNPERMITTED');
      },
    },
  };
  const exhaustedDouble = async (_r, input) =>
    input === own ? { id: 'own-incident', operationId: 'operation' } : { id: 'foreign-incident' };
  try {
    const row = {};
    await run(
      r,
      row,
      async () => foreign,
      recoveryApi,
      exhaustedDouble,
      async () => structuredClone(persisted),
      own,
      own.actor.organizationId,
      assert,
    );
    assert.deepEqual(
      row.http.map((result) => result.http),
      [200, 400, 201, 409, 404, 401, 401, 403],
    );
    assert.equal(requests.length, 8);
    assert.equal(terminalDecision, true);
    assert.equal(own.authToken, 'synthetic-token');
    assert.deepEqual(persisted, { generation: 1, audit: 1 });
    memberStatus = 'ACTIVE';
    permitted = true;
    terminalDecision = false;
    requests.length = 0;
    persisted.generation = 0;
    persisted.audit = 0;
    mutateOnDenial = true;
    await assert.rejects(
      run(
        r,
        {},
        async () => foreign,
        recoveryApi,
        exhaustedDouble,
        async () => structuredClone(persisted),
        own,
        own.actor.organizationId,
        assert,
      ),
      { code: 'ERR_ASSERTION' },
      'A negative HTTP response must not conceal a persisted mutation',
    );
    assert.equal(terminalDecision, false);
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = previousUrl;
    server.close();
    server.closeAllConnections();
    await once(server, 'close');
  }
});
