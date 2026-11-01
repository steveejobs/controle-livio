import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Linux') process.exit(0);

const runId = process.env.GITHUB_RUN_ID;
const runnerTemp = process.env.RUNNER_TEMP;
if (!/^\d+$/.test(runId ?? '') || !runnerTemp) process.exit(0);

const name = `livio-clamav-${runId}`;
const marker = join(runnerTemp, `${name}.json`);
if (!existsSync(marker)) process.exit(0);

const expected = JSON.parse(readFileSync(marker, 'utf8'));
const inspected = execFileSync('docker', ['inspect', '--format', '{{.Id}}', name], {
  encoding: 'utf8',
}).trim();
if (inspected !== expected.containerId) {
  console.error(
    'Container ClamAV não corresponde ao identificador desta execução; limpeza cancelada.',
  );
  process.exitCode = 1;
} else {
  const stopped = spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
  if (stopped.status !== 0) process.exitCode = 1;
}
rmSync(marker, { force: true });
