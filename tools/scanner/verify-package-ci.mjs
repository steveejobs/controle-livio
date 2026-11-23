import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { join, resolve } from 'node:path';

assert.equal(process.platform, 'linux', 'Disposable Linux runner required');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.SCANNER_PACKAGE_CI, 'disposable');
assert(/^\d+$/.test(process.env.GITHUB_RUN_ID ?? ''));
assert(process.env.RUNNER_TEMP && process.env.GITHUB_WORKSPACE);
assert.equal(resolve(process.cwd()), resolve(process.env.GITHUB_WORKSPACE));
assert(!process.env.DOCKER_HOST, 'Remote Docker daemons are forbidden');
assert(!process.env.DOCKER_CONTEXT || process.env.DOCKER_CONTEXT === 'default');
const dockerEndpoint = execFileSync(
  'docker',
  ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
  { encoding: 'utf8' },
).trim();
assert.equal(dockerEndpoint, 'unix:///var/run/docker.sock');

const output = mkdtempSync(join(process.env.RUNNER_TEMP, 'livio-scanner-package-'));
const certificates = join(output, 'certificates');
mkdirSync(certificates);
const project = `livio-scanner-ci-${process.env.GITHUB_RUN_ID}-${randomBytes(4).toString('hex')}`;
const token = randomBytes(32).toString('hex');
const env = {
  ...process.env,
  SCANNER_TOKEN: token,
  SCANNER_DOMAIN: 'localhost',
  SCANNER_BIND_ADDRESS: '127.0.0.1',
  SCANNER_HTTPS_PORT: '9443',
};
const base = resolve('tools/scanner/compose.yaml');
const override = join(output, 'override.json');
const args = ['compose', '--project-name', project, '-f', base, '-f', override];
const report = { project, checks: [], startedAt: new Date().toISOString() };
writeFileSync(
  join(process.env.RUNNER_TEMP, 'scanner-package-summary.json'),
  JSON.stringify({ ...report, result: 'IN_PROGRESS' }),
);
let sequence = 0;
const docker = (parameters, secretOutput = false) => {
  const r = spawnSync('docker', parameters, {
    env,
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (!secretOutput)
    writeFileSync(
      join(output, `${sequence++}-docker.log`),
      (r.stdout ?? '') + '\n' + (r.stderr ?? ''),
    );
  if (r.status !== 0)
    throw new Error(
      'Owned Docker operation failed: ' +
        (r.stderr ?? '').replaceAll(token, '[redacted]').slice(-2500),
    );
  return r.stdout;
};
const check = (name) => {
  report.checks.push({ name, result: 'PASS' });
  console.log(JSON.stringify({ check: name, result: 'PASS' }));
};

// Private, ephemeral CA: verification stays enabled, without contacting a public CA.
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-keyout',
    join(output, 'root.key'),
    '-out',
    join(output, 'root.crt'),
    '-subj',
    '/CN=Livio Scanner CI Root',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
  ],
  { stdio: 'ignore' },
);
execFileSync(
  'openssl',
  [
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(certificates, 'server.key'),
    '-out',
    join(output, 'server.csr'),
    '-subj',
    '/CN=localhost',
  ],
  { stdio: 'ignore' },
);
writeFileSync(
  join(output, 'extensions'),
  'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n',
);
execFileSync(
  'openssl',
  [
    'x509',
    '-req',
    '-in',
    join(output, 'server.csr'),
    '-CA',
    join(output, 'root.crt'),
    '-CAkey',
    join(output, 'root.key'),
    '-CAcreateserial',
    '-days',
    '1',
    '-out',
    join(certificates, 'server.crt'),
    '-extfile',
    join(output, 'extensions'),
  ],
  { stdio: 'ignore' },
);
chmodSync(join(output, 'root.key'), 0o600);
chmodSync(join(certificates, 'server.key'), 0o444);
const caddySource = readFileSync('tools/scanner/Caddyfile', 'utf8');
assert(caddySource.includes('{$SCANNER_DOMAIN} {'));
const testCaddy = join(output, 'Caddyfile');
writeFileSync(
  testCaddy,
  caddySource.replace(
    '{$SCANNER_DOMAIN} {',
    '{$SCANNER_DOMAIN} {\n\ttls /certs/server.crt /certs/server.key',
  ),
);
writeFileSync(
  override,
  JSON.stringify({
    services: {
      proxy: { volumes: [`${testCaddy}:/etc/caddy/Caddyfile:ro`, `${certificates}:/certs:ro`] },
    },
  }),
);
const existing = docker([
  'ps',
  '--all',
  '--filter',
  `label=com.docker.compose.project=${project}`,
  '--format',
  '{{.ID}}',
]);
assert.equal(existing.trim(), '', 'Existing projects must never be reused');
const config = JSON.parse(docker([...args, 'config', '--format', 'json'], true));
assert.equal(config.services.antivirus.ports.length, 1);
assert.equal(config.services.antivirus.ports[0].host_ip, '127.0.0.1');
assert.equal(Number(config.services.antivirus.ports[0].target), 443);
assert(config.services.antivirus.tmpfs.some((mount) => mount.startsWith('/tmp:')));
assert(config.services.antivirus.tmpfs.some((mount) => mount.startsWith('/var/tmp:')));
assert(!config.services.gateway.ports && !config.services.proxy.ports);
assert.equal(config.services.gateway.network_mode, 'service:antivirus');
check('resolved compose publishes only loopback HTTPS; no clamd or gateway port');

const ca = readFileSync(join(output, 'root.crt'));
const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
function scan(body, credential = token, trusted = true, method = 'POST') {
  return new Promise((done, reject) => {
    const req = request(
      {
        hostname: 'localhost',
        family: 4,
        port: 9443,
        path: '/scan',
        method,
        ca: trusted ? ca : undefined,
        headers: {
          Authorization: `Bearer ${credential}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': body.length,
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 2048) res.destroy(new Error('Unexpected proxy response size'));
          else chunks.push(chunk);
        });
        res.once('end', () =>
          done({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.once('error', reject);
      },
    );
    req.setTimeout(15_000, () => req.destroy(new Error('HTTPS request timeout')));
    req.once('error', reject);
    req.end(body);
  });
}

try {
  docker([...args, 'up', '--detach', '--build', '--wait', '--wait-timeout', '480']);
  const version = docker([...args, 'exec', '-T', 'antivirus', 'clamd', '--version']).trim();
  assert(/^ClamAV 1\.5\.4\//.test(version));
  report.scannerVersion = version;
  check('pinned official ClamAV and gateway are healthy');
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      assert.equal((await scan(Buffer.alloc(0), token, true, 'GET')).status, 404);
      break;
    } catch (error) {
      if (!['ECONNREFUSED', 'ECONNRESET'].includes(error.code) || Date.now() >= deadline)
        throw error;
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  const clean = await scan(Buffer.from('synthetic clean payload'));
  assert.equal(clean.status, 200);
  assert.deepEqual(JSON.parse(clean.body), { verdict: 'clean' });
  const infected = await scan(eicar);
  assert.equal(infected.status, 200);
  assert.deepEqual(JSON.parse(infected.body), { verdict: 'infected' });
  check('real HTTPS and ClamAV classify clean and EICAR payloads');
  assert.equal((await scan(Buffer.from('synthetic'), 'invalid-token')).status, 401);
  assert.equal((await scan(Buffer.alloc(0), token, true, 'GET')).status, 404);
  assert.equal((await scan(Buffer.alloc(4 * 1024 * 1024 + 1))).status, 413);
  check('authentication, method and file size limits are enforced');
  await assert.rejects(scan(Buffer.from('synthetic'), token, false), (error) =>
    /SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(error.code ?? ''),
  );
  check('untrusted TLS certificates are rejected');
  const clientCode = `const assert=require('node:assert/strict');const {scanHttps}=require('./apps/api/dist/documents/scanner-https.js');(async()=>{await scanHttps(Buffer.from('synthetic clean'),'https://localhost:9443/scan',process.env.SCANNER_TOKEN,12000);await assert.rejects(scanHttps(Buffer.from(process.env.SCANNER_EICAR,'base64'),'https://localhost:9443/scan',process.env.SCANNER_TOKEN,12000),e=>e.getStatus?.()===422);})().catch(e=>{console.error(JSON.stringify({name:e.name,status:e.getStatus?.(),code:e.code}));process.exitCode=1;});`;
  const client = spawnSync(process.execPath, ['-e', clientCode], {
    env: {
      ...env,
      SCANNER_EICAR: eicar.toString('base64'),
      NODE_EXTRA_CA_CERTS: join(output, 'root.crt'),
      NODE_OPTIONS: '--dns-result-order=ipv4first',
    },
    timeout: 40_000,
    encoding: 'utf8',
  });
  writeFileSync(
    join(output, 'compiled-client.log'),
    (client.stdout ?? '') + '\n' + (client.stderr ?? ''),
  );
  assert.equal(client.status, 0);
  check('compiled API HTTPS client accepts clean files and rejects infection');
  docker([...args, 'pause', 'antivirus']);
  try {
    assert.equal((await scan(Buffer.from('synthetic daemon timeout'))).status, 503);
  } finally {
    docker([...args, 'unpause', 'antivirus']);
  }
  check('daemon timeout fails closed without exposing files');
  assert.equal((await scan(Buffer.from('synthetic after recovery'))).status, 200);
  check('scanner recovers after the daemon resumes');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = { name: error.name, code: error.code ?? null };
  console.error(error.message.replaceAll(token, '[redacted]').slice(-2500));
  try {
    const logs = docker([...args, 'logs', '--no-color', '--tail', '15']);
    report.failureDiagnostics = logs.replaceAll(token, '[redacted]').slice(-6000);
  } catch {
    report.failureDiagnostics = 'Owned container logs unavailable';
  }
  process.exitCode = 1;
} finally {
  try {
    docker([...args, 'stop', '--timeout', '20']);
    report.ownedResourcesStopped = true;
  } catch {
    report.ownedResourcesStopped = false;
    report.result = 'FAIL';
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  writeFileSync(
    join(process.env.RUNNER_TEMP, 'scanner-package-summary.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      result: report.result,
      checks: report.checks.length,
      ownedResourcesStopped: report.ownedResourcesStopped,
    }),
  );
}
