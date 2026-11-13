import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
  assert.equal(
    setting('STORAGE_BACKEND'),
    'file',
    'Coordinated restore supports only this disposable file backend',
  );
  assert.equal(setting('FILE_STORAGE_BACKEND_PATH'), '/var/lib/storage');
  const volume = storage.Mounts.find((m) => m.Destination === '/var/lib/storage');
  assert.equal(volume?.Type, 'volume', 'Only a named disposable Storage volume is supported');
  assert.ok(volume.Name.includes(project), 'Storage volume must belong to the same project');
  return {
    project,
    cluster: direct,
    databaseContainer: container.Id,
    storageContainer: storage.Id,
    volume: volume.Name,
    storageImage: storage.Image,
    tenantId: setting('TENANT_ID'),
  };
}
