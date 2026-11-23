import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

assert.equal(process.platform, 'linux');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.SCANNER_PACKAGE_CI, 'disposable');
assert(/^\d+$/.test(process.env.GITHUB_RUN_ID ?? ''));
assert.equal(resolve(process.cwd()), resolve(process.env.GITHUB_WORKSPACE));
assert(!process.env.DOCKER_HOST);
assert(!process.env.DOCKER_CONTEXT || process.env.DOCKER_CONTEXT === 'default');
assert.equal(
  execFileSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], {
    encoding: 'utf8',
  }).trim(),
  'unix:///var/run/docker.sock',
);

const name = `livio-vercel-ci-${process.env.GITHUB_RUN_ID}-${randomBytes(4).toString('hex')}`;
const token = randomBytes(32).toString('hex');
const report = { result: 'IN_PROGRESS', checks: [], memoryLimitBytes: 2 * 1024 ** 3 };
const path = join(process.env.RUNNER_TEMP, 'scanner-vercel-summary.json');
let created = false;
const docker = (args) => {
  const result = spawnSync('docker', args, {
    env: { ...process.env, SCANNER_TOKEN: token },
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error('Owned container operation failed: ' + (result.stderr ?? '').slice(-2000));
  return result.stdout.trim();
};
const check = (name) => {
  report.checks.push(name);
  console.log(JSON.stringify({ check: name, result: 'PASS' }));
};
const scan = async (body, credential = token) => {
  const r = await fetch('http://127.0.0.1:9444/scan', {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}` },
    body,
    signal: AbortSignal.timeout(65_000),
  });
  return { status: r.status, body: await r.json() };
};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
async function readyScan() {
  const deadline = Date.now() + 160_000;
  while (true) {
    try {
      const r = await scan('synthetic clean document');
      if (r.status === 200) return r;
      assert.equal(r.status, 503);
    } catch (error) {
      if (Date.now() >= deadline) throw error;
    }
    if (Date.now() >= deadline) throw new Error('Scanner never became ready');
    await wait(1000);
  }
}
try {
  assert.equal(docker(['ps', '-aq', '--filter', `name=^/${name}$`]), '');
  docker(['build', '-f', 'tools/scanner/Dockerfile.vercel', '-t', name, 'tools/scanner']);
  docker([
    'run',
    '-d',
    '--name',
    name,
    '--memory',
    '2g',
    '--memory-swap',
    '2g',
    '--cpus',
    '1',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,size=512m,mode=1777',
    '--ulimit',
    'core=0',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '-p',
    '127.0.0.1:9444:8080',
    '-e',
    'SCANNER_TOKEN',
    name,
  ]);
  created = true;
  const state = JSON.parse(docker(['inspect', name]))[0];
  assert.equal(state.HostConfig.Memory, report.memoryLimitBytes);
  assert.equal(state.HostConfig.MemorySwap, report.memoryLimitBytes);
  assert.equal(state.HostConfig.ReadonlyRootfs, true);
  assert.equal(state.HostConfig.PortBindings['8080/tcp'][0].HostIp, '127.0.0.1');
  check('read-only container is bounded to 2 GiB, one CPU and 512 MiB scratch');
  const start = Date.now();
  const clean = await readyScan();
  report.coldStartMs = Date.now() - start;
  assert.deepEqual(clean.body, { verdict: 'clean' });
  const eicar = Buffer.from(
    'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  );
  assert.deepEqual(await scan(eicar), { status: 200, body: { verdict: 'infected' } });
  assert.equal((await scan('synthetic', 'incorrect')).status, 401);
  assert.equal((await scan(Buffer.alloc(4 * 1024 * 1024 + 1))).status, 413);
  check('real ClamAV detects EICAR and accepts clean files; auth and size enforced');
  // Exercise the operational refresh without modifying signed vendor databases.
  const pid = docker(['exec', name, 'pgrep', '-x', 'clamd']);
  docker(['kill', '--signal', 'USR1', name]);
  const afterUpdate = await readyScan();
  assert.deepEqual(afterUpdate.body, { verdict: 'clean' });
  assert.deepEqual((await scan(eicar)).body, { verdict: 'infected' });
  assert.notEqual(docker(['exec', name, 'pgrep', '-x', 'clamd']), pid);
  check('real FreshClam check and engine restart remain within the memory limit');
  report.peakMemoryBytes = Number(docker(['exec', name, 'cat', '/sys/fs/cgroup/memory.peak']));
  assert(report.peakMemoryBytes > 0 && report.peakMemoryBytes <= report.memoryLimitBytes);
  assert.equal(JSON.parse(docker(['inspect', name]))[0].State.OOMKilled, false);
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = error.message.replaceAll(token, '[redacted]').slice(-2500);
  if (created) {
    report.diagnostics = docker(['logs', '--tail', '12', name]).replaceAll(token, '[redacted]');
    report.containerState = JSON.parse(docker(['inspect', name]))[0].State;
  }
  process.exitCode = 1;
} finally {
  if (created) docker(['stop', '--timeout', '10', name]);
  report.ownedResourcesStopped = true;
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
