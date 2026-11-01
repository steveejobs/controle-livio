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
const {
  PdfContentInspectionService,
} = require('../../apps/api/dist/documents/pdf-content-inspection.service.js');
const { extractPdfScanTargets } = require('../../apps/api/dist/documents/pdf-embedded-files.js');
const { createCanvas } = require('@napi-rs/canvas');
const { PDFDocument, StandardFonts } = require('pdf-lib');
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
  return new DocumentScannerService(
    { get: (key) => values[key] },
    new PdfContentInspectionService(),
  );
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
    record(name, 'PASS', {
      ...details,
      expectedStatus,
      actualStatus: statusOf(error),
      verdict: details.verdict ?? 'expected-rejection',
    });
    return true;
  } catch (error) {
    const actualStatus = statusOf(error);
    record(name, 'FAIL', {
      ...details,
      expectedStatus,
      actualStatus: actualStatus ?? null,
      verdict:
        actualStatus !== undefined
          ? 'wrong-http-status'
          : error instanceof Error &&
              error.message.includes('scanner request unexpectedly succeeded')
            ? 'unexpectedly-accepted'
            : 'scan-error',
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

async function pdfBytes({
  embeddedFile,
  compress = true,
  pageContentEicar = false,
  pageTextEicar = false,
  scannedPageText,
} = {}) {
  const document = await PDFDocument.create();
  const page = document.addPage(scannedPageText ? [6_000, 300] : [600, 144]);
  if (pageTextEicar) {
    const font = await document.embedFont(StandardFonts.Courier);
    page.drawText(eicar, { x: 12, y: 72, size: 9, font });
  }
  if (pageContentEicar) {
    const imageContent = Buffer.concat([
      Buffer.from(
        `q\nBI\n/W ${Buffer.byteLength(eicar, 'ascii')}\n/H 1\n/BPC 8\n/CS /G\nID\n`,
        'ascii',
      ),
      Buffer.from(eicar, 'ascii'),
      Buffer.from('\nEI\nQ\n', 'ascii'),
    ]);
    const pageContentStream = document.context.flateStream(imageContent);
    page.node.addContentStream(document.context.register(pageContentStream));
  }
  if (scannedPageText) {
    const canvas = createCanvas(6_000, 300);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 6_000, 300);
    context.fillStyle = '#000';
    context.font = '120px Arial';
    context.fillText(scannedPageText, 20, 210);
    const image = await document.embedPng(canvas.toBuffer('image/png'));
    page.drawImage(image, { x: 0, y: 0, width: 6_000, height: 300 });
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
  // ClamAV debug output includes EICAR signature names while loading databases.
  // The documented process exit status is the verdict: 0 clean, 1 infected, 2 error.
  const exitVerdict = result.status === 0 ? 'CLEAN' : result.status === 1 ? 'INFECTED' : 'ERROR';
  const outputLines = output.split(/\r?\n/);
  const resultLines = outputLines
    .filter((line) =>
      /^\[fixture\]:\s+(?:.*\sFOUND|OK)\s*$/.test(line.replaceAll(containerPath, '[fixture]')),
    )
    .slice(0, 4)
    .map((line) => line.replaceAll(containerPath, '[fixture]').slice(0, 400));
  const lineVerdict = resultLines.some((line) => /\sFOUND\s*$/.test(line))
    ? 'INFECTED'
    : resultLines.some((line) => /:\s*OK\s*$/.test(line))
      ? 'CLEAN'
      : 'ERROR';
  const verdict = exitVerdict === lineVerdict ? exitVerdict : 'ERROR';
  const debugHighlights = outputLines
    .filter((line) => /pdf|embed|eicar|signature|stream|scan result|known viruses/i.test(line))
    .slice(0, 80)
    .map((line) => line.replaceAll(containerPath, '[fixture]').slice(0, 400));
  return {
    fixture: fixtureName,
    scanner: binary,
    exitCode: result.status,
    verdict,
    resultLines,
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
    ['page-text-eicar.pdf', await pdfBytes({ pageTextEicar: true })],
    ['page-stream-image-bytes-eicar.pdf', await pdfBytes({ pageContentEicar: true })],
    ['scanned-page-eicar.pdf', await pdfBytes({ scannedPageText: eicar })],
    ['embedded-eicar-uncompressed.pdf', await pdfBytes({ embeddedFile: eicar, compress: false })],
    ['embedded-eicar-compressed.pdf', await pdfBytes({ embeddedFile: eicar })],
    ['embedded-clean-parser-verified.pdf', await pdfBytes({ embeddedFile: benignAttachment })],
  ];
  const inspector = new PdfContentInspectionService();
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
    let inspection;
    let parserError;
    if (isPdf) {
      try {
        targets = await extractPdfScanTargets(bytes);
        inspection = await inspector.inspect(bytes);
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
          ? targets.pageContents.length === 0 &&
            targets.embeddedFiles.length === 0 &&
            inspection.text.length === 0 &&
            inspection.ocrText.length === 0
          : name === 'page-text-eicar.pdf'
            ? !bytes.includes(expectedContents) &&
              targets.pageContents.some((stream) =>
                stream.toString('latin1').includes(expectedContents.toString('hex').toUpperCase()),
              ) &&
              !targets.pageContents.some((stream) => stream.includes(expectedContents)) &&
              inspection.text.includes(expectedContents) &&
              inspection.ocrText.length === 0
            : name === 'page-stream-image-bytes-eicar.pdf'
              ? targets.pageContents.some((stream) => stream.includes(expectedContents)) &&
                !inspection.text.includes(expectedContents) &&
                !inspection.ocrText.includes(expectedContents)
              : name === 'scanned-page-eicar.pdf'
                ? inspection.ocrPageCount === 1 &&
                  /^X5[O0]/.test(
                    inspection.ocrText.toString('utf8').toUpperCase().replace(/\s+/g, ''),
                  ) &&
                  inspection.ocrText
                    .toString('utf8')
                    .toUpperCase()
                    .replace(/\s+/g, '')
                    .includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') &&
                  inspection.ocrText
                    .toString('utf8')
                    .toUpperCase()
                    .replace(/\s+/g, '')
                    .endsWith('H+H*')
                : targets.embeddedFiles.some((stream) => stream.equals(expectedContents)));
    if (!parserVerified) {
      results.push({
        fixture: name,
        bytes: bytes.length,
        parserValidated: false,
        parserError: parserError ?? 'expected content was not recovered from the fixture structure',
        pageStreamsDecoded: targets.pageContents.length,
        embeddedFilesExtracted: targets.embeddedFiles.length,
        pageCount: inspection?.pageCount ?? null,
        ocrPageCount: inspection?.ocrPageCount ?? null,
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
          pageCount: inspection?.pageCount ?? null,
          ocrPageCount: inspection?.ocrPageCount ?? null,
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
      contentKind:
        name === 'raw-eicar.bin'
          ? 'raw EICAR control'
          : name === 'clean.pdf'
            ? 'clean PDF without text or attachments'
            : name === 'page-text-eicar.pdf'
              ? 'visible page text hex encoded in a compressed PDF content stream'
              : name === 'page-stream-image-bytes-eicar.pdf'
                ? 'literal EICAR bytes in inline image samples; not visible text'
                : name === 'scanned-page-eicar.pdf'
                  ? 'EICAR rendered as a scanned page image and inspected by OCR'
                  : name.startsWith('embedded-eicar')
                    ? 'EmbeddedFile attachment'
                    : 'clean EmbeddedFile attachment',
      bytes: bytes.length,
      parserValidated: true,
      externalValidator: isPdf && qpdfAvailable ? 'qpdf --check PASS' : null,
      pageStreamsDecoded: targets.pageContents.length,
      embeddedFilesExtracted: targets.embeddedFiles.length,
      pageCount: inspection?.pageCount ?? null,
      ocrPageCount: inspection?.ocrPageCount ?? null,
      pageTextContainsEicar: inspection?.text.toString('ascii').includes(eicar) ?? false,
      ocrTextContainsEicarCore:
        inspection?.ocrText.toString('ascii').includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') ??
        false,
      fixtureContentsVerifiedByParser: parserVerified,
      clamscan,
      clamdscan,
    });
    persistMatrixProgress();
  }

  const raw = results.find(({ fixture }) => fixture === 'raw-eicar.bin');
  const clean = results.find(({ fixture }) => fixture === 'clean.pdf');
  const pageText = results.find(({ fixture }) => fixture === 'page-text-eicar.pdf');
  const scannedPage = results.find(({ fixture }) => fixture === 'scanned-page-eicar.pdf');
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
  const pdfTextExtractionPass = pageText?.fixtureContentsVerifiedByParser === true;
  const ocrExtractionPass = scannedPage?.fixtureContentsVerifiedByParser === true;
  const directScanCasesComplete =
    qpdfAvailable &&
    results.length === fixtureBytes.length &&
    results.every(
      ({ fixture, parserValidated, externalValidator, clamscan, clamdscan }) =>
        parserValidated === true &&
        (fixture === 'raw-eicar.bin' || externalValidator === 'qpdf --check PASS') &&
        ['CLEAN', 'INFECTED'].includes(clamscan?.verdict) &&
        ['CLEAN', 'INFECTED'].includes(clamdscan?.verdict),
    );

  const extractedInfectedPdf = service();
  let applicationExtractionPass = true;
  let isolatedStreamScanPass = true;
  let isolatedTextScanPass = true;
  for (const name of ['embedded-eicar-uncompressed.pdf', 'embedded-eicar-compressed.pdf']) {
    const bytes = fixtureBytes.find(([fixture]) => fixture === name)?.[1];
    if (!bytes) fail(`the generated scanner matrix is missing ${name}.`);
    const targets = await extractPdfScanTargets(bytes);
    const scanTarget = targets.embeddedFiles.find((content) =>
      content.includes(Buffer.from(eicar, 'ascii')),
    );
    if (!scanTarget) fail(`the expected EICAR scan target was not extracted from ${name}.`);
    isolatedStreamScanPass =
      (await recordExpectedStatus(
        `isolated-stream-${name}`,
        () => extractedInfectedPdf.assertClean(scanTarget),
        422,
        { verdict: 'embedded-file-extracted-and-detected-by-clamd' },
      )) && isolatedStreamScanPass;
    applicationExtractionPass =
      (await recordExpectedStatus(
        `application-extracted-${name}`,
        () => extractedInfectedPdf.assertClean(bytes, 'application/pdf'),
        422,
        { verdict: 'embedded-file-rejected-after-application-extraction' },
      )) && applicationExtractionPass;
  }
  for (const name of ['page-text-eicar.pdf', 'scanned-page-eicar.pdf']) {
    const bytes = fixtureBytes.find(([fixture]) => fixture === name)?.[1];
    if (!bytes) fail(`the generated scanner matrix is missing ${name}.`);
    const inspection = await inspector.inspect(bytes);
    const text = name === 'page-text-eicar.pdf' ? inspection.text : inspection.ocrText;
    const extractedFixture = saveFixture(`${name}.extracted.txt`, text);
    const extractedClamscan = directScan(
      'clamscan',
      `${name}-extracted-text`,
      extractedFixture.hostPath,
      extractedFixture.containerPath,
    );
    const extractedClamdscan = directScan(
      'clamdscan',
      `${name}-extracted-text`,
      extractedFixture.hostPath,
      extractedFixture.containerPath,
    );
    const directTextScanPass =
      name === 'page-text-eicar.pdf'
        ? extractedClamscan.verdict === 'INFECTED' && extractedClamdscan.verdict === 'INFECTED'
        : ['CLEAN', 'INFECTED'].includes(extractedClamscan.verdict) &&
          ['CLEAN', 'INFECTED'].includes(extractedClamdscan.verdict);
    isolatedTextScanPass = directTextScanPass && isolatedTextScanPass;
    const applicationPassed = await recordExpectedStatus(
      `application-extracted-${name}`,
      () => extractedInfectedPdf.assertClean(bytes, 'application/pdf'),
      422,
      {
        verdict:
          name === 'scanned-page-eicar.pdf'
            ? 'OCR-EICAR-fingerprint-rechecked-by-clamd'
            : 'PDF.js-page-text-scanned-by-clamd',
      },
    );
    applicationExtractionPass = applicationPassed && applicationExtractionPass;
    record(`isolated-extracted-text-${name}`, directTextScanPass ? 'PASS' : 'FAIL', {
      extractedTextBytes: text.length,
      clamscan: extractedClamscan,
      clamdscan: extractedClamdscan,
      applicationPassed,
      note:
        name === 'scanned-page-eicar.pdf'
          ? 'OCR output contains the EICAR core but confuses punctuation; the app sends the anchored canonical test signature to ClamAV.'
          : 'PDF.js extracted the compressed page text, which ClamAV detects as EICAR.',
    });
  }
  const inlineImageBytes = fixtureBytes.find(
    ([fixture]) => fixture === 'page-stream-image-bytes-eicar.pdf',
  )?.[1];
  if (!inlineImageBytes) fail('the inline-image byte fixture is missing.');
  const inlineInspection = await inspector.inspect(inlineImageBytes);
  const inlineTargets = await extractPdfScanTargets(inlineImageBytes);
  const inlineStream = inlineTargets.pageContents.find((content) =>
    content.includes(Buffer.from(eicar, 'ascii')),
  );
  if (!inlineStream) fail('the inline-image byte fixture was not extracted.');
  const extractedStream = saveFixture('inline-image-eicar-stream.bin', inlineStream);
  const inlineStreamVerdict = directScan(
    'clamdscan',
    'inline-image-eicar-stream',
    extractedStream.hostPath,
    extractedStream.containerPath,
  );
  let inlineApplicationVerdict = 'CLEAN';
  try {
    await extractedInfectedPdf.assertClean(inlineImageBytes, 'application/pdf');
  } catch (error) {
    inlineApplicationVerdict = statusOf(error) === 422 ? 'INFECTED' : 'ERROR';
  }
  const inlineImageDistinctionPass =
    !inlineInspection.text.toString('ascii').includes(eicar) &&
    !inlineInspection.ocrText.toString('ascii').includes(eicar) &&
    ['CLEAN', 'INFECTED'].includes(inlineStreamVerdict.verdict) &&
    ['CLEAN', 'INFECTED'].includes(inlineApplicationVerdict);
  record('inline-image-binary-eicar-distinction', inlineImageDistinctionPass ? 'PASS' : 'FAIL', {
    contentKind: 'literal EICAR bytes in inline-image samples; not visible text or OCR output',
    pdfjsTextContainsEicar: inlineInspection.text.toString('ascii').includes(eicar),
    ocrTextContainsEicar: inlineInspection.ocrText.toString('ascii').includes(eicar),
    decodedStreamVerdict: inlineStreamVerdict.verdict,
    applicationVerdict: inlineApplicationVerdict,
  });
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
      directScanCasesComplete &&
      pdfTextExtractionPass &&
      ocrExtractionPass &&
      fixtureParserPass &&
      isolatedStreamScanPass &&
      isolatedTextScanPass &&
      applicationExtractionPass &&
      inlineImageDistinctionPass &&
      cleanAttachmentApplicationPass
        ? 'PASS'
        : 'FAIL',
    baseScannerCasesPass,
    directScanCasesComplete,
    pdfTextExtractionPass,
    ocrExtractionPass,
    fixtureParserPass,
    isolatedStreamScanPass,
    isolatedTextScanPass,
    applicationExtractionPass,
    inlineImageDistinctionPass,
    qpdfAvailable,
    qpdfVersion: qpdfAvailable ? qpdfVersion.stdout.trim() : null,
    note: 'Original files, page streams, EmbeddedFiles, PDF.js text, and OCR are tested separately. OCR can confuse EICAR punctuation; the app only canonicalizes an OCR line when the full EICAR marker and start/end anchors remain, then asks ClamAV for the verdict.',
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
