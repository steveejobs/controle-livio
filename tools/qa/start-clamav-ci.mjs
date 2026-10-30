import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function fail(message) {
  console.error(`ClamAV CI indisponível: ${message}`);
  process.exit(1);
}

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Linux')
  fail('o serviço só pode ser iniciado no runner Linux descartável do GitHub.');

const host = process.env.CLAMAV_HOST;
const port = process.env.CLAMAV_PORT;
const runId = process.env.GITHUB_RUN_ID;
const markerDirectory = process.env.RUNNER_TEMP;
if (host !== '127.0.0.1' || port !== '13310' || !/^\d+$/.test(runId ?? '') || !markerDirectory)
  fail('host, porta ou identificador do runner não correspondem ao perfil loopback esperado.');

const name = `livio-clamav-${runId}`;
const existing = spawnSync('docker', ['inspect', name], { stdio: 'ignore' });
if (existing.status === 0) fail('já existe um container com o nome reservado para esta execução.');
if (existing.error) fail('Docker não está disponível no runner.');

execFileSync('docker', ['pull', 'clamav/clamav:stable'], { stdio: 'ignore' });
mkdirSync(markerDirectory, { recursive: true });
const containerId = execFileSync(
  'docker',
  [
    'run',
    '--detach',
    '--name',
    name,
    '--publish',
    `127.0.0.1:${port}:3310`,
    'clamav/clamav:stable',
  ],
  { encoding: 'utf8' },
).trim();
const imageDigest = execFileSync('docker', ['inspect', '--format', '{{.Image}}', name], {
  encoding: 'utf8',
}).trim();
const scannerVersion = execFileSync('docker', ['exec', name, 'clamd', '--version'], {
  encoding: 'utf8',
}).trim();

const markerPath = join(markerDirectory, `${name}.json`);
writeFileSync(markerPath, JSON.stringify({ name, containerId, imageDigest, scannerVersion }), {
  encoding: 'utf8',
  flag: 'wx',
});
console.log('ClamAV oficial iniciado; a única porta publicada está ligada a 127.0.0.1 do runner.');
