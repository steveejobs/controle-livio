import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

function fail(message) {
  throw new Error(`ClamAV CI validation failed: ${message}`);
}

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Linux')
  fail('the real scanner check requires the disposable Linux GitHub runner.');

const host = process.env.CLAMAV_HOST;
const port = Number(process.env.CLAMAV_PORT);
const timeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS);
const runId = process.env.GITHUB_RUN_ID;
const runnerTemp = process.env.RUNNER_TEMP;
if (
  host !== '127.0.0.1' ||
  port !== 13310 ||
  !Number.isInteger(timeoutMs) ||
  timeoutMs < 500 ||
  timeoutMs > 60_000 ||
  !/^\d+$/.test(runId ?? '') ||
  !runnerTemp
)
  fail('scanner endpoint or runner paths do not match the loopback-only profile.');

const container = `livio-clamav-${runId}`;
const markerPath = join(runnerTemp, `${container}.json`);
if (!existsSync(markerPath)) fail('the current run does not own a ClamAV test container.');
const containerMetadata = JSON.parse(readFileSync(markerPath, 'utf8'));
const require = createRequire(import.meta.url);
const {
  DocumentScannerService,
} = require('../../apps/api/dist/documents/document-scanner.service.js');
const { ServiceUnavailableException } = require('@nestjs/common');
const outputDirectory = join(runnerTemp, 'livio-integrated-artifacts');
const reportPath = join(outputDirectory, 'clamav-rehearsal.json');
const previousReport =
  process.argv[2] === '--failure-modes' && existsSync(reportPath)
    ? JSON.parse(readFileSync(reportPath, 'utf8'))
    : undefined;
if (
  process.argv[2] === '--failure-modes' &&
  (!previousReport?.results?.['clean-file'] || !previousReport?.results?.['eicar-detection'])
)
  fail('clean-file and EICAR checks must pass before failure-mode checks.');
const report = previousReport ?? {
  status: 'IN_PROGRESS',
  scannerImage: 'clamav/clamav:stable',
  scannerImageDigest: containerMetadata.imageDigest,
  scannerVersion: containerMetadata.scannerVersion,
  scannerHost: '127.0.0.1',
  scannerPort: port,
  results: {},
};

function service(overrides = {}) {
  const values = {
    SUPABASE_ENVIRONMENT: 'staging',
    SUPABASE_LOCAL: false,
    CLAMAV_HOST: host,
    CLAMAV_PORT: port,
    CLAMAV_TIMEOUT_MS: timeoutMs,
    ...overrides,
  };
  return new DocumentScannerService({ get: (key) => values[key] });
}

function record(name, status, details) {
  report.results[name] = { status, ...details };
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function expectHttpStatus(operation, status) {
  try {
    await operation;
  } catch (error) {
    if (typeof error?.getStatus === 'function' && error.getStatus() === status) return error;
    throw error;
  }
  fail(`scanner request unexpectedly succeeded instead of returning ${status}.`);
}

async function verifyReady() {
  const cleanService = service();
  const deadline = Date.now() + 180_000;
  let lastFailure;
  while (Date.now() < deadline) {
    try {
      await cleanService.assertClean(Buffer.from('livio synthetic clean scanner probe'));
      lastFailure = undefined;
      break;
    } catch (error) {
      lastFailure = error;
      if (!(error instanceof ServiceUnavailableException)) throw error;
      await delay(2_000);
    }
  }
  if (lastFailure) fail('official clamd did not become ready within three minutes.');
  record('clean-file', 'PASS', { verdict: 'clean' });

  const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
  await expectHttpStatus(cleanService.assertClean(Buffer.from(eicar, 'ascii')), 422);
  record('eicar-detection', 'PASS', { verdict: 'infected-rejected' });
}

async function verifyFailureModes() {
  execFileSync('docker', ['pause', container], { stdio: 'ignore' });
  const pausedAt = Date.now();
  try {
    await expectHttpStatus(
      service({ CLAMAV_TIMEOUT_MS: 1_500 }).assertClean(Buffer.from('timeout probe')),
      503,
    );
    const elapsedMs = Date.now() - pausedAt;
    if (elapsedMs < 1_000 || elapsedMs > 6_000)
      fail(`paused daemon did not exercise the configured socket timeout (${elapsedMs} ms).`);
    record('paused-daemon-timeout', 'PASS', { elapsedMs, verdict: 'release-blocked' });
  } finally {
    execFileSync('docker', ['unpause', container], { stdio: 'ignore' });
  }

  const recoveryDeadline = Date.now() + 30_000;
  let recovered = false;
  while (Date.now() < recoveryDeadline) {
    try {
      await service().assertClean(Buffer.from('post-timeout recovery probe'));
      recovered = true;
      break;
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      await delay(1_000);
    }
  }
  if (!recovered) fail('clamd did not recover after the pause was released.');

  execFileSync('docker', ['stop', container], { stdio: 'ignore' });
  await expectHttpStatus(service().assertClean(Buffer.from('unavailable probe')), 503);
  record('stopped-daemon-unavailable', 'PASS', { verdict: 'release-blocked' });
}

const mode = process.argv[2];
if (mode === '--ready') await verifyReady();
else if (mode === '--failure-modes') await verifyFailureModes();
else fail('expected --ready or --failure-modes.');

const results = Object.values(report.results);
if (results.some((result) => result.status !== 'PASS')) fail('one or more scanner checks failed.');
if (mode === '--ready') {
  report.status = 'READY';
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
if (mode === '--failure-modes') {
  report.status = Object.values(report.results).every((result) => result.status === 'PASS')
    ? 'PASS'
    : 'FAIL';
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (report.status !== 'PASS') fail('final scanner report is not clean.');
  console.log('Real ClamAV clean, EICAR, timeout and unavailable checks passed.');
}
