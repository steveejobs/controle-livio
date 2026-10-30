import { execFileSync, spawnSync } from 'node:child_process';
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
const { extractPdfScanTargets } = require('../../apps/api/dist/documents/pdf-embedded-files.js');
const { PDFDocument } = require('pdf-lib');
const { ServiceUnavailableException } = require('@nestjs/common');
const outputDirectory = join(runnerTemp, 'livio-integrated-artifacts');
const reportPath = join(outputDirectory, 'clamav-rehearsal.json');
const previousReport =
  process.argv[2] === '--failure-modes' && existsSync(reportPath)
    ? JSON.parse(readFileSync(reportPath, 'utf8'))
    : undefined;
const report = previousReport ?? {
  status: 'IN_PROGRESS',
  scannerImage: containerMetadata.image,
  scannerImageDigest: containerMetadata.imageDigest,
  scannerVersion: containerMetadata.scannerVersion,
  effectiveScannerConfig: containerMetadata.effectiveScannerConfig,
  scannerEndpoint: '127.0.0.1:13310 (runner loopback only)',
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

async function pdfBytes({ embeddedFile, compress = true, pageContentEicar = false } = {}) {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 144]);
  if (pageContentEicar) {
    const commentStream = document.context.flateStream(Buffer.from(`% ${eicar}\n`, 'ascii'));
    page.node.addContentStream(document.context.register(commentStream));
  }
  if (embeddedFile !== undefined)
    await document.attach(Buffer.from(embeddedFile, 'ascii'), 'eicar.com', {
      mimeType: 'application/octet-stream',
      description: 'Synthetic ClamAV scanner test',
      afRelationship: 'Data',
    });

  const context = document.context;
  const originalFlateStream = context.flateStream;
  if (!compress)
    context.flateStream = function (contents, dictionary) {
      return this.stream(contents, dictionary);
    };
  try {
    const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
    const parsed = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
    if (parsed.getPageCount() !== 1) fail('a generated PDF fixture failed parser validation.');
    return bytes;
  } finally {
    context.flateStream = originalFlateStream;
  }
}

const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const benignAttachment = 'LIVIO-SYNTHETIC-CLEAN-ATTACHMENT';

function directScan(binary, fixtureName, hostPath, containerPath) {
  const result = spawnSync(
    'docker',
    [
      'exec',
      container,
      binary,
      ...(binary === 'clamscan' ? ['--debug', '--no-summary', '--scan-pdf=yes'] : ['--verbose']),
      containerPath,
    ],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const detected = /(?:Eicar|FOUND)/i.test(output);
  const clean = result.status === 0 && /(?:OK|Infected files:\s*0)/i.test(output);
  const verdict = detected ? 'INFECTED' : clean ? 'CLEAN' : 'ERROR';
  const debugHighlights = output
    .split(/\r?\n/)
    .filter((line) => /pdf|embed|eicar|signature|stream|scan result|known viruses/i.test(line))
    .slice(0, 80)
    .map((line) => line.replaceAll(containerPath, '[fixture]').slice(0, 400));
  return {
    fixture: fixtureName,
    scanner: binary,
    exitCode: result.status,
    verdict,
    debugHighlights,
    fixtureBytes: readFileSync(hostPath).length,
  };
}

function saveFixture(name, bytes) {
  const hostPath = join(runnerTemp, `livio-${name}`);
  const containerPath = `/tmp/livio-${name}`;
  writeFileSync(hostPath, bytes, { flag: 'w' });
  execFileSync('docker', ['cp', hostPath, `${container}:${containerPath}`]);
  return { hostPath, containerPath };
}

async function runPdfEicarMatrix() {
  const qpdfVersion = spawnSync('qpdf', ['--version'], { encoding: 'utf8' });
  const qpdfAvailable = qpdfVersion.status === 0;
  const fixtureBytes = [
    ['raw-eicar.bin', Buffer.from(eicar, 'ascii')],
    ['clean.pdf', await pdfBytes()],
    ['page-content-eicar.pdf', await pdfBytes({ pageContentEicar: true })],
    ['embedded-eicar-uncompressed.pdf', await pdfBytes({ embeddedFile: eicar, compress: false })],
    ['embedded-eicar-compressed.pdf', await pdfBytes({ embeddedFile: eicar })],
    ['embedded-clean-parser-verified.pdf', await pdfBytes({ embeddedFile: benignAttachment })],
  ];
  const results = [];
  const persistMatrixProgress = (status = 'IN_PROGRESS') => {
    report.results['clamav-pdf-matrix'] = {
      status,
      qpdfAvailable,
      qpdfVersion: qpdfAvailable ? qpdfVersion.stdout.trim() : null,
      fixtures: results,
    };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  };
  for (const [name, bytes] of fixtureBytes) {
    const { hostPath, containerPath } = saveFixture(name, bytes);
    const isPdf = name.endsWith('.pdf');
    let targets = { pageContents: [], embeddedFiles: [] };
    let parserError;
    if (isPdf) {
      try {
        targets = await extractPdfScanTargets(bytes);
      } catch (error) {
        parserError = error instanceof Error ? error.message.slice(0, 240) : 'PDF parse failed';
      }
    }
    const expectedContents = Buffer.from(
      name.includes('clean') ? benignAttachment : eicar,
      'ascii',
    );
    const parserVerified =
      !parserError &&
      (name === 'raw-eicar.bin'
        ? bytes.equals(expectedContents)
        : name === 'clean.pdf'
          ? targets.pageContents.length === 0 && targets.embeddedFiles.length === 0
          : name === 'page-content-eicar.pdf'
            ? targets.pageContents.some((stream) => stream.includes(expectedContents))
            : targets.embeddedFiles.some((stream) => stream.equals(expectedContents)));
    if (!parserVerified) {
      results.push({
        fixture: name,
        bytes: bytes.length,
        parserValidated: false,
        parserError: parserError ?? 'expected content was not recovered from the fixture structure',
        pageStreamsDecoded: targets.pageContents.length,
        embeddedFilesExtracted: targets.embeddedFiles.length,
        fixtureContentsVerifiedByParser: false,
      });
      persistMatrixProgress();
      continue;
    }
    if (qpdfAvailable && isPdf) {
      const qpdfCheck = spawnSync('qpdf', ['--check', hostPath], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      if (qpdfCheck.status !== 0) {
        results.push({
          fixture: name,
          bytes: bytes.length,
          parserValidated: false,
          externalValidator: 'qpdf --check FAIL',
          pageStreamsDecoded: targets.pageContents.length,
          embeddedFilesExtracted: targets.embeddedFiles.length,
          fixtureContentsVerifiedByParser: parserVerified,
        });
        persistMatrixProgress();
        continue;
      }
    }
    const clamscan = directScan('clamscan', name, hostPath, containerPath);
    const clamdscan = directScan('clamdscan', name, hostPath, containerPath);
    results.push({
      fixture: name,
      bytes: bytes.length,
      parserValidated: true,
      externalValidator: isPdf && qpdfAvailable ? 'qpdf --check PASS' : null,
      pageStreamsDecoded: targets.pageContents.length,
      embeddedFilesExtracted: targets.embeddedFiles.length,
      fixtureContentsVerifiedByParser: parserVerified,
      clamscan,
      clamdscan,
    });
    persistMatrixProgress();
  }

  const raw = results.find(({ fixture }) => fixture === 'raw-eicar.bin');
  const clean = results.find(({ fixture }) => fixture === 'clean.pdf');
  const cleanAttachment = results.find(
    ({ fixture }) => fixture === 'embedded-clean-parser-verified.pdf',
  );
  const baseScannerCasesPass =
    raw?.clamscan?.verdict === 'INFECTED' &&
    raw.clamdscan.verdict === 'INFECTED' &&
    clean?.clamscan?.verdict === 'CLEAN' &&
    clean.clamdscan.verdict === 'CLEAN' &&
    cleanAttachment?.clamscan?.verdict === 'CLEAN' &&
    cleanAttachment.clamdscan.verdict === 'CLEAN';

  const extractedInfectedPdf = service();
  let applicationExtractionPass = true;
  for (const name of [
    'page-content-eicar.pdf',
    'embedded-eicar-uncompressed.pdf',
    'embedded-eicar-compressed.pdf',
  ]) {
    const bytes = fixtureBytes.find(([fixture]) => fixture === name)?.[1];
    if (!bytes) fail(`the generated scanner matrix is missing ${name}.`);
    applicationExtractionPass =
      (await recordExpectedStatus(
        `application-extracted-${name}`,
        () => extractedInfectedPdf.assertClean(bytes, 'application/pdf'),
        422,
        { verdict: 'pdf-content-rejected-after-application-extraction' },
      )) && applicationExtractionPass;
  }
  const cleanAttachmentBytes = fixtureBytes.find(
    ([fixture]) => fixture === 'embedded-clean-parser-verified.pdf',
  )?.[1];
  if (!cleanAttachmentBytes) fail('the clean embedded attachment fixture is missing.');
  let cleanAttachmentApplicationPass = true;
  try {
    await extractedInfectedPdf.assertClean(cleanAttachmentBytes, 'application/pdf');
  } catch (error) {
    cleanAttachmentApplicationPass = false;
    record('application-clean-embedded-attachment', 'FAIL', {
      verdict: 'clean-attachment-rejected',
      actualStatus: statusOf(error) ?? null,
    });
  }
  if (cleanAttachmentApplicationPass)
    record('application-clean-embedded-attachment', 'PASS', { verdict: 'clean' });
  const fixtureParserPass =
    results.length === fixtureBytes.length &&
    results.every(({ parserValidated }) => parserValidated === true);
  report.results['clamav-pdf-matrix'] = {
    status:
      baseScannerCasesPass &&
      fixtureParserPass &&
      applicationExtractionPass &&
      cleanAttachmentApplicationPass
        ? 'PASS'
        : 'FAIL',
    baseScannerCasesPass,
    fixtureParserPass,
    qpdfAvailable,
    qpdfVersion: qpdfAvailable ? qpdfVersion.stdout.trim() : null,
    note: 'Direct PDF verdicts are recorded per scanner; decoded page and embedded streams are separately scanned by the application.',
    fixtures: results,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const logs = execFileSync('docker', ['logs', '--tail', '100', container], { encoding: 'utf8' });
  report.daemonLogHighlights = logs
    .split(/\r?\n/)
    .filter((line) => /database|signature|clamd|ready|loaded/i.test(line))
    .slice(-60)
    .map((line) => line.replaceAll(eicar, '[EICAR TEST SIGNATURE]').slice(0, 400));
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
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
  await recordVerdict(
    'clean-pdf',
    async () => cleanService.assertClean(await pdfBytes(), 'application/pdf'),
    undefined,
    'clean',
  );
  await recordVerdict(
    'eicar-detection',
    () => cleanService.assertClean(Buffer.from(eicar, 'ascii')),
    422,
    'infected-rejected',
  );
  await runPdfEicarMatrix();
  report.readyStatus = 'PASS';
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
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
if (mode === '--ready') {
  try {
    await verifyReady();
  } catch (error) {
    report.readyStatus = 'FAIL';
    report.readyError =
      error instanceof Error ? error.message.slice(0, 300) : 'scanner readiness failed';
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    throw error;
  }
} else if (mode === '--failure-modes') await verifyFailureModes();
else fail('expected --ready or --failure-modes.');

const results = Object.values(report.results);
if (mode === '--ready') {
  report.readyStatus = results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL';
  report.status = report.readyStatus;
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (report.readyStatus !== 'PASS')
    fail('one or more clean/EICAR scanner checks failed; see sanitized report.');
}
if (mode === '--failure-modes') {
  const failureModeNames = new Set([
    'paused-daemon-timeout',
    'clamav-resumed-after-timeout',
    'post-timeout-recovery',
    'stopped-daemon-unavailable',
  ]);
  const failureModeResults = Object.entries(report.results).filter(([name]) =>
    failureModeNames.has(name),
  );
  report.failureModesStatus =
    failureModeResults.length === failureModeNames.size &&
    failureModeResults.every(([, result]) => result.status === 'PASS')
      ? 'PASS'
      : 'FAIL';
  // Failure-mode checks run independently, but cannot convert an incomplete or failed scanner
  // readiness/PDF matrix into an overall PASS.
  report.status =
    report.readyStatus === 'PASS' && report.failureModesStatus === 'PASS' ? 'PASS' : 'FAIL';
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (report.failureModesStatus !== 'PASS') fail('scanner timeout/unavailable checks failed.');
  if (report.readyStatus !== 'PASS') fail('scanner readiness/PDF matrix did not pass in this run.');
  console.log('Real ClamAV clean, EICAR, timeout and unavailable checks passed.');
}
