import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateRecoveryEnvironment } from './environment.mjs';
import { projectName, docker } from './stack-identity.mjs';

function evidenceDirectory(env, options = {}) {
  assert.equal(options.platform ?? process.platform, 'linux');
  assert.equal(env.GITHUB_ACTIONS, 'true');
  assert.equal(env.RUNNER_OS, 'Linux');
  assert.equal(env.LIVIO_STORAGE_RECOVERY, 'disposable-new-stack');
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.SUPABASE_LOCAL, 'true');
  assert.equal(env.SUPABASE_ENVIRONMENT, 'test');
  assert.equal(env.STORAGE_RECOVERY_DISPATCH_ENABLED, 'true');
  assert.equal(env.STORAGE_RECOVERY_DELETE_ENABLED, 'true');
  assert.ok(
    !env.DOCKER_HOST && !env.DOCKER_CONTEXT && !env.DOCKER_TLS_VERIFY,
    'Remote Docker cleanup refused',
  );
  assert.ok(env.RUNNER_TEMP && env.LIVIO_QA_OUTPUT);
  const boundary = relative(resolve(env.RUNNER_TEMP), resolve(env.LIVIO_QA_OUTPUT));
  assert.ok(!boundary.startsWith('..') && !isAbsolute(boundary));
  return resolve(env.LIVIO_QA_OUTPUT);
}

export function cleanupTarget(env = process.env, options = {}) {
  const directory = evidenceDirectory(env, options);
  const file = resolve(directory, 'recovery-target.json');
  // coordinated-restore persists this marker before invoking target creation.
  // Missing marker means this runner has not started creating a destination.
  if (!(options.exists ?? existsSync)(file))
    return { status: 'NOT_EXECUTED', reason: 'NO_RESTORE_DESTINATION_RECORDED' };
  validateRecoveryEnvironment(env, options.root ?? process.cwd(), options);
  const marker = JSON.parse((options.read ?? readFileSync)(file, 'utf8'));
  const project = projectName({ LIVIO_RECOVERY_PROJECT: marker.project });
  assert.ok(project.startsWith('livio-recovery-' + env.GITHUB_RUN_ID + '-'));
  assert.match(String(marker.sourceCluster), /^\d+$/);
  const run = options.docker ?? docker;
  const inventory = () => {
    const ids = run([
      'ps',
      '-a',
      '--filter',
      'label=com.supabase.cli.project=' + project,
      '--format',
      '{{.ID}}',
    ])
      .toString()
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    assert.ok(ids.every((id) => /^[a-f0-9]{12,64}$/.test(id)));
    // Read-only listing also detects project volumes left after containers stop.
    // Names of unrelated volumes never leave this function or become deletion input.
    const volumes = run(['volume', 'ls', '--format', '{{.Name}}'])
      .toString()
      .trim()
      .split(/\s+/)
      .filter((name) => name.endsWith('_' + project))
      .sort();
    return { ids, volumes };
  };
  const before = inventory();
  if (!before.ids.length) {
    if (before.volumes.length)
      throw Object.assign(new Error('Destination volumes need identity review'), {
        code: 'RECOVERY_TARGET_IDENTITY_INCOMPLETE',
        project,
        volumes: before.volumes,
      });
    return { status: 'ABSENT_VERIFIED', project, containers: 0, namedProjectVolumes: 0 };
  }
  const containers = JSON.parse(run(['inspect', ...before.ids]).toString());
  assert.equal(containers.length, before.ids.length);
  for (const container of containers) {
    assert.equal(container.Config?.Labels?.['com.supabase.cli.project'], project);
    assert.ok(container.Name?.endsWith('_' + project));
    for (const mount of container.Mounts ?? [])
      if (mount.Type === 'volume')
        assert.ok(mount.Name?.endsWith('_' + project), 'Unknown volume; cleanup denied');
  }
  const db = containers.find((c) => c.Name === '/supabase_db_' + project);
  const storage = containers.find((c) => c.Name === '/supabase_storage_' + project);
  if (!db || !storage)
    throw Object.assign(new Error('Partial destination needs identity review'), {
      code: 'RECOVERY_TARGET_IDENTITY_INCOMPLETE',
      project,
    });
  assert.ok(
    db.NetworkSettings?.Ports?.['5432/tcp']?.some(
      (p) => p.HostPort === new URL(env.DATABASE_URL).port,
    ),
  );
  const volume = storage.Mounts?.find((m) => m.Destination === '/var/lib/storage');
  assert.equal(volume?.Type, 'volume');
  assert.ok(before.volumes.includes(volume.Name));
  const cluster = run([
    'exec',
    db.Id,
    'psql',
    '-X',
    '-qAt',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-c',
    'SELECT system_identifier::text FROM pg_control_system();',
  ])
    .toString()
    .trim();
  assert.match(cluster, /^\d+$/);
  assert.notEqual(
    cluster,
    String(marker.sourceCluster),
    'Source cluster must never be cleaned as target',
  );
  (
    options.stop ??
    ((name) =>
      execFileSync(
        resolve('node_modules/.bin/supabase'),
        ['stop', '--project-id', name, '--no-backup'],
        { stdio: 'ignore' },
      ))
  )(project);
  const after = inventory();
  if (after.ids.length || after.volumes.length)
    throw Object.assign(new Error('Target cleanup is incomplete'), {
      code: 'RECOVERY_TARGET_CLEANUP_INCOMPLETE',
      project,
    });
  return {
    status: 'PASS',
    project,
    cluster,
    volume: volume.Name,
    containersBefore: before.ids.length,
    containersAfter: 0,
    namedProjectVolumesAfter: 0,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let result;
  try {
    result = cleanupTarget();
  } catch (error) {
    result = {
      status: 'FAIL',
      event: 'RECOVERY_TARGET_CLEANUP_FAILED',
      name: error.name,
      code: error.code ?? null,
    };
    process.exitCode = 1;
  }
  try {
    const directory = evidenceDirectory(process.env);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      resolve(directory, 'recovery-cleanup.json'),
      JSON.stringify(result, null, 2) + '\n',
    );
  } catch {
    console.error(
      JSON.stringify({
        event: 'CLEANUP_EVIDENCE_UNAVAILABLE',
        reason: 'SAFE_EVIDENCE_PATH_NOT_VERIFIED',
      }),
    );
    process.exitCode = 1;
  }
  console.log(JSON.stringify(result));
}
