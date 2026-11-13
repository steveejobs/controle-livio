import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { copyTree } from './volume-copy.mjs';
import { delayedProvider } from './delayed-provider.mjs';
import { projectName } from './stack-identity.mjs';
import { cleanupTarget } from './cleanup-target.mjs';

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
    Config: { Labels: labels },
    Mounts: [
      { Type: 'volume', Name: 'supabase_storage_' + project, Destination: '/var/lib/storage' },
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
      if (args[0] === 'volume') return state.volumes.join('\n');
      if (args[0] === 'inspect') return JSON.stringify(state.containers);
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
