import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { validateRecoveryEnvironment } from './environment.mjs';

export function docker(args, options = {}) {
  try {
    return execFileSync('docker', args, {
      maxBuffer: 128 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    });
  } catch {
    throw Object.assign(new Error('DISPOSABLE_DOCKER_COMMAND_FAILED'), {
      code: 'DISPOSABLE_DOCKER_COMMAND_FAILED',
    });
  }
}
export function projectName(env = process.env) {
  const project = env.LIVIO_RECOVERY_PROJECT ?? 'livio-legal-crm';
  assert.ok(project === 'livio-legal-crm' || /^livio-recovery-[0-9]+-[a-f0-9]{8}$/.test(project));
  return project;
}
export function ownContainer(service, project, running = true) {
  projectName({ LIVIO_RECOVERY_PROJECT: project });
  assert.ok(['db', 'storage', 'auth', 'rest', 'kong'].includes(service));
  const [container] = JSON.parse(docker(['inspect', `supabase_${service}_${project}`]));
  assert.equal(container.Config.Labels['com.supabase.cli.project'], project);
  if (running) assert.equal(container.State.Running, true);
  return container;
}
export const sql = (project, query) =>
  docker(
    [
      'exec',
      '-i',
      ownContainer('db', project).Id,
      'psql',
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    { input: query },
  );
export function storageVolumeIdentity(storage, project) {
  projectName({ LIVIO_RECOVERY_PROJECT: project });
  assert.equal(storage.Config?.Labels?.['com.supabase.cli.project'], project);
  assert.equal(storage.Name, '/supabase_storage_' + project);
  const setting = (key) => {
    const values = (storage.Config?.Env ?? []).filter((value) => value.startsWith(key + '='));
    assert.equal(values.length, 1, 'Storage setting must have one unambiguous value');
    return values[0].slice(key.length + 1);
  };
  assert.equal(setting('STORAGE_BACKEND'), 'file');
  const backendPath = setting('FILE_STORAGE_BACKEND_PATH');
  assert.ok(
    ['/mnt', '/var/lib/storage'].includes(backendPath),
    'Unsupported disposable backend path',
  );
  const mounts = (storage.Mounts ?? []).filter((m) => m.Destination === backendPath);
  assert.equal(mounts.length, 1, 'Configured backend must have one exact mount');
  assert.equal(storage.Mounts.length, 1, 'Unknown additional Storage mount');
  const volume = mounts[0];
  assert.equal(volume.Type, 'volume', 'Only a named disposable Storage volume is supported');
  assert.equal(volume.Name, 'supabase_storage_' + project);
  return { backendPath, volume: volume.Name };
}

export function verifyStorageVolume(storage, project, run = docker) {
  const identity = storageVolumeIdentity(storage, project);
  const [volume, ...extra] = JSON.parse(run(['volume', 'inspect', identity.volume]).toString());
  assert.equal(extra.length, 0);
  assert.equal(volume.Name, identity.volume);
  assert.equal(volume.Driver, 'local');
  assert.equal(volume.Scope, 'local');
  assert.equal(Object.keys(volume.Options ?? {}).length, 0, 'External/bind volume options denied');
  if (volume.Labels?.['com.supabase.cli.project'])
    assert.equal(volume.Labels['com.supabase.cli.project'], project);
  assert.equal(storage.Mounts[0].Source, volume.Mountpoint);
  assert.ok(volume.Mountpoint?.startsWith('/'), 'Absolute Docker volume identity required');
  const physical = JSON.parse(
    run([
      'exec',
      storage.Id,
      'node',
      '-e',
      "const fs=require('node:fs'),p=process.env.FILE_STORAGE_BACKEND_PATH;if(!['/mnt','/var/lib/storage'].includes(p))process.exit(2);const s=fs.statSync(p,{bigint:true});console.log(JSON.stringify({backendPath:p,realPath:fs.realpathSync(p),directory:s.isDirectory(),device:s.dev.toString(),inode:s.ino.toString()}));",
    ]).toString(),
  );
  assert.equal(physical.backendPath, identity.backendPath);
  assert.equal(physical.realPath, identity.backendPath, 'Backend symlink/alias denied');
  assert.equal(physical.directory, true);
  assert.match(physical.device, /^\d+$/);
  assert.match(physical.inode, /^\d+$/);
  return {
    ...identity,
    volumeIdentity: {
      name: volume.Name,
      driver: volume.Driver,
      scope: volume.Scope,
      mountpoint: volume.Mountpoint,
      createdAt: volume.CreatedAt ?? null,
    },
    physical,
  };
}

export async function assertOwnedStack(db, env = process.env) {
  validateRecoveryEnvironment(env);
  const project = projectName(env),
    container = ownContainer('db', project);
  const ports = container.NetworkSettings.Ports['5432/tcp'];
  assert.ok(ports?.some((p) => p.HostPort === new URL(env.DATABASE_URL).port));
  const [{ system_identifier: remote }] =
    await db.$queryRaw`SELECT system_identifier::text FROM pg_control_system()`;
  const direct = sql(project, 'SELECT system_identifier::text FROM pg_control_system();')
    .toString()
    .trim();
  assert.equal(remote, direct, 'Loopback SQL endpoint must be this owned Docker cluster');
  if (env.LIVIO_RECOVERY_CLUSTER) assert.equal(direct, env.LIVIO_RECOVERY_CLUSTER);
  const storage = ownContainer('storage', project);
  const gateway = ownContainer('kong', project);
  assert.ok(
    gateway.NetworkSettings.Ports['8000/tcp']?.some(
      (p) => p.HostPort === new URL(env.SUPABASE_URL).port,
    ),
    'Storage/Auth gateway must be the owned project endpoint',
  );
  ownContainer('auth', project);
  ownContainer('rest', project);
  const setting = (key) =>
    storage.Config.Env.find((value) => value.startsWith(key + '='))?.slice(key.length + 1);
  const directory = resolve(env.LIVIO_QA_OUTPUT);
  const boundary = relative(resolve(env.RUNNER_TEMP), directory);
  assert.ok(!boundary.startsWith('..') && !isAbsolute(boundary));
  const observed = {
    project,
    cluster: direct,
    container: storage.Id,
    name: storage.Name,
    backend: setting('STORAGE_BACKEND'),
    backendPath: setting('FILE_STORAGE_BACKEND_PATH'),
    mounts: storage.Mounts.map((m) => ({
      type: m.Type,
      name: m.Name ?? null,
      destination: m.Destination,
    })),
    checkpoint: 'BEFORE_PHYSICAL_IDENTITY',
  };
  mkdirSync(directory, { recursive: true });
  const evidenceFile = resolve(directory, project + '-storage-identity.json');
  writeFileSync(evidenceFile, JSON.stringify(observed, null, 2) + '\n');
  const identity = verifyStorageVolume(storage, project);
  writeFileSync(
    evidenceFile,
    JSON.stringify({ ...observed, ...identity, checkpoint: 'VERIFIED' }, null, 2) + '\n',
  );
  return {
    project,
    cluster: direct,
    databaseContainer: container.Id,
    storageContainer: storage.Id,
    volume: identity.volume,
    backendPath: identity.backendPath,
    volumeIdentity: identity.volumeIdentity,
    physical: identity.physical,
    storageImage: storage.Image,
    tenantId: setting('TENANT_ID'),
  };
}
