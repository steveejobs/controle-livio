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
const image = 'clamav/clamav:1.5.4-debian13-slim';
const existing = spawnSync('docker', ['inspect', name], { stdio: 'ignore' });
if (existing.status === 0) fail('já existe um container com o nome reservado para esta execução.');
if (existing.error) fail('Docker não está disponível no runner.');

execFileSync('docker', ['pull', image], { stdio: 'ignore' });
mkdirSync(markerDirectory, { recursive: true });
const containerId = execFileSync(
  'docker',
  ['run', '--detach', '--name', name, '--publish', `127.0.0.1:${port}:3310`, image],
  { encoding: 'utf8' },
).trim();
const imageDigest = execFileSync('docker', ['inspect', '--format', '{{.Image}}', name], {
  encoding: 'utf8',
}).trim();
const scannerVersion = execFileSync('docker', ['exec', name, 'clamd', '--version'], {
  encoding: 'utf8',
}).trim();
if (!/^ClamAV 1\.5\.4\//.test(scannerVersion))
  fail(`a imagem versionada não iniciou ClamAV 1.5.4 (${scannerVersion.split('/')[0]}).`);

const clamconf = execFileSync('docker', ['exec', name, 'clamconf'], { encoding: 'utf8' });
function effectiveSetting(key) {
  const value = clamconf.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]+)`, 'm'))?.[1];
  if (!value) fail(`clamconf não informou a configuração efetiva ${key}.`);
  return value.trim();
}
function sizeInBytes(value) {
  const match = value.match(/^(\d+)([KMG]?)$/i);
  if (!match) fail(`valor efetivo inválido para limite do scanner (${value}).`);
  const factor = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[match[2].toUpperCase()] ?? 1;
  return Number(match[1]) * factor;
}
const effectiveScannerConfig = {
  scanPdf: effectiveSetting('ScanPDF').toLowerCase(),
  maxFileSize: effectiveSetting('MaxFileSize'),
  maxScanSize: effectiveSetting('MaxScanSize'),
  maxRecursion: Number(effectiveSetting('MaxRecursion')),
  maxFiles: Number(effectiveSetting('MaxFiles')),
  streamMaxLength: effectiveSetting('StreamMaxLength'),
};
if (
  effectiveScannerConfig.scanPdf !== 'yes' ||
  sizeInBytes(effectiveScannerConfig.maxFileSize) < 4 * 1024 * 1024 ||
  sizeInBytes(effectiveScannerConfig.maxScanSize) < 4 * 1024 * 1024 ||
  sizeInBytes(effectiveScannerConfig.streamMaxLength) < 4 * 1024 * 1024 ||
  effectiveScannerConfig.maxRecursion < 1 ||
  effectiveScannerConfig.maxFiles < 1
)
  fail('ScanPDF ou os limites efetivos do daemon não cobrem os uploads suportados.');

const markerPath = join(markerDirectory, `${name}.json`);
writeFileSync(
  markerPath,
  JSON.stringify({
    name,
    containerId,
    image,
    imageDigest,
    scannerVersion,
    signatureDatabaseVersion: scannerVersion.match(/^ClamAV [^/]+\/([^/]+)/)?.[1] ?? null,
    effectiveScannerConfig,
  }),
  {
    encoding: 'utf8',
    flag: 'wx',
  },
);
console.log(
  `ClamAV oficial ${scannerVersion.split('/')[0]} iniciado; ScanPDF=${effectiveScannerConfig.scanPdf}; StreamMaxLength=${effectiveScannerConfig.streamMaxLength}; a única porta está ligada ao loopback do runner.`,
);
