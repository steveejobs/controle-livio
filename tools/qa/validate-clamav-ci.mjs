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

function statusOf(error) {
  return typeof error?.getStatus === 'function' ? error.getStatus() : undefined;
}

async function recordExpectedStatus(name, operation, expectedStatus, details = {}) {
  try {
    const error = await expectHttpStatus(operation(), expectedStatus);
    record(name, 'PASS', { expectedStatus, actualStatus: statusOf(error), ...details });
    return true;
  } catch (error) {
    const actualStatus = statusOf(error);
    record(name, 'FAIL', {
      expectedStatus,
      actualStatus: actualStatus ?? null,
      verdict:
        actualStatus !== undefined
          ? 'wrong-http-status'
          : error instanceof Error &&
              error.message.includes('scanner request unexpectedly succeeded')
            ? 'unexpectedly-accepted'
            : 'scan-error',
      ...details,
    });
    return false;
  }
}

async function recordVerdict(name, operation, expectedStatus, verdict) {
  try {
    if (expectedStatus === undefined) {
      await operation();
      record(name, 'PASS', { verdict });
    } else {
      await recordExpectedStatus(name, operation, expectedStatus, { verdict });
    }
  } catch (error) {
    record(name, 'FAIL', {
      expectedStatus: expectedStatus ?? 'clean',
      actualStatus: statusOf(error) ?? null,
      verdict: 'scan-error',
    });
  }
}

function pdfBytes(embeddedFile) {
  const content = 'BT /F1 12 Tf 20 70 Td (Synthetic scanner probe) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  if (embeddedFile !== undefined) {
    const fileSpecObjectNumber = objects.length + 1;
    const embeddedFileObjectNumber = objects.length + 2;
    const embeddedFileSize = Buffer.byteLength(embeddedFile, 'ascii');
    objects[0] = `<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(eicar.com) ${fileSpecObjectNumber} 0 R] >> >> /AF [${fileSpecObjectNumber} 0 R] >>`;
    objects.push(
      `<< /Type /Filespec /F (eicar.com) /UF (eicar.com) /Desc (ClamAV EICAR scanner test) /AFRelationship /Data /EF << /F ${embeddedFileObjectNumber} 0 R /UF ${embeddedFileObjectNumber} 0 R >> >>`,
      `<< /Type /EmbeddedFile /Subtype /application#2Foctet-stream /Params << /Size ${embeddedFileSize} >> /Length ${embeddedFileSize} >>\nstream\n${embeddedFile}\nendstream`,
    );
  }

  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document, 'ascii'));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document, 'ascii');
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, 'ascii');
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
  if (lastFailure) {
    record('clean-file', 'FAIL', { verdict: 'scanner-unavailable' });
    report.status = 'FAIL';
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fail('official clamd did not become ready within three minutes.');
  }
  record('clean-file', 'PASS', { verdict: 'clean' });
  await recordVerdict('clean-pdf', () => cleanService.assertClean(pdfBytes()), undefined, 'clean');

  const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
  await recordVerdict(
    'eicar-detection',
    () => cleanService.assertClean(Buffer.from(eicar, 'ascii')),
    422,
    'infected-rejected',
  );
  await recordVerdict(
    'eicar-pdf-detection',
    () => cleanService.assertClean(pdfBytes(eicar)),
    422,
    'infected-rejected',
  );
}

async function verifyFailureModes() {
  let pausedAt = Date.now();
  try {
    execFileSync('docker', ['pause', container], { stdio: 'ignore' });
    pausedAt = Date.now();
    const error = await expectHttpStatus(
      service({ CLAMAV_TIMEOUT_MS: 1_500 }).assertClean(Buffer.from('timeout probe')),
      503,
    );
    const elapsedMs = Date.now() - pausedAt;
    const elapsedInRange = elapsedMs >= 1_000 && elapsedMs <= 6_000;
    record('paused-daemon-timeout', elapsedInRange ? 'PASS' : 'FAIL', {
      expectedStatus: 503,
      actualStatus: statusOf(error),
      elapsedMs,
      verdict: elapsedInRange ? 'release-blocked' : 'unexpected-timeout-duration',
    });
  } catch (error) {
    record('paused-daemon-timeout', 'FAIL', {
      expectedStatus: 503,
      actualStatus: statusOf(error) ?? null,
      verdict:
        error instanceof Error && error.message.includes('scanner request unexpectedly succeeded')
          ? 'unexpectedly-accepted'
          : 'timeout-probe-failed',
    });
  } finally {
    try {
      execFileSync('docker', ['unpause', container], { stdio: 'ignore' });
      record('clamav-resumed-after-timeout', 'PASS', { verdict: 'daemon-resumed' });
    } catch {
      record('clamav-resumed-after-timeout', 'FAIL', { verdict: 'daemon-not-resumed' });
    }
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
  record('post-timeout-recovery', recovered ? 'PASS' : 'FAIL', {
    verdict: recovered ? 'daemon-available' : 'daemon-did-not-recover',
  });

  try {
    execFileSync('docker', ['stop', container], { stdio: 'ignore' });
    await recordExpectedStatus(
      'stopped-daemon-unavailable',
      () => service().assertClean(Buffer.from('unavailable probe')),
      503,
      { verdict: 'release-blocked' },
    );
  } catch (error) {
    record('stopped-daemon-unavailable', 'FAIL', {
      expectedStatus: 503,
      actualStatus: statusOf(error) ?? null,
      verdict: 'daemon-stop-probe-failed',
    });
  }
}

const mode = process.argv[2];
if (mode === '--ready') await verifyReady();
else if (mode === '--failure-modes') await verifyFailureModes();
else fail('expected --ready or --failure-modes.');

const results = Object.values(report.results);
if (mode === '--ready') {
  report.status = results.every((result) => result.status === 'PASS') ? 'READY' : 'FAIL';
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (report.status !== 'READY')
    fail('one or more clean/EICAR scanner checks failed; see sanitized report.');
}
if (mode === '--failure-modes') {
  report.status = Object.values(report.results).every((result) => result.status === 'PASS')
    ? 'PASS'
    : 'FAIL';
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (report.status !== 'PASS') fail('final scanner report is not clean.');
  console.log('Real ClamAV clean, EICAR, timeout and unavailable checks passed.');
}
