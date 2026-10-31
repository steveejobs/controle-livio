import { createServer, type AddressInfo } from 'node:net';
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { createCanvas } from '@napi-rs/canvas';
import { AFRelationship, PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { DocumentScannerService } from './document-scanner.service';
import { PdfContentInspectionService } from './pdf-content-inspection.service';
import { extractPdfScanTargets } from './pdf-embedded-files';

function config(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as never;
}

async function scanner(reply: string | ((file: Buffer) => string)) {
  let requests = 0;
  const scannedFiles: Buffer[] = [];
  const server = createServer((socket) => {
    let input = Buffer.alloc(0);
    let file = Buffer.alloc(0);
    let commandRead = false;
    socket.on('data', (chunk) => {
      input = Buffer.concat([input, chunk]);
      if (!commandRead) {
        const commandEnd = input.indexOf(0);
        if (commandEnd < 0) return;
        expect(input.subarray(0, commandEnd).toString('ascii')).toBe('zINSTREAM');
        input = input.subarray(commandEnd + 1);
        commandRead = true;
      }

      while (input.length >= 4) {
        const length = input.readUInt32BE(0);
        if (input.length < 4 + length) return;
        if (length > 0) file = Buffer.concat([file, input.subarray(4, 4 + length)]);
        input = input.subarray(4 + length);
        if (length === 0) {
          requests += 1;
          scannedFiles.push(file);
          socket.end(typeof reply === 'string' ? reply : reply(file));
          return;
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return { server, port: address.port, requests: () => requests, files: () => scannedFiles };
}

const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

async function pdfWithEmbeddedEicar() {
  const document = await PDFDocument.create();
  document.addPage([300, 144]);
  await document.attach(Buffer.from(eicar, 'ascii'), 'eicar.com', {
    mimeType: 'application/octet-stream',
    afRelationship: AFRelationship.Data,
  });
  const context = document.context;
  const originalFlateStream = context.flateStream;
  context.flateStream = function (contents, dictionary) {
    return this.stream(contents, dictionary);
  };
  try {
    return Buffer.from(await document.save({ useObjectStreams: false }));
  } finally {
    context.flateStream = originalFlateStream;
  }
}

async function pdfWithPageContentEicar() {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 144]);
  const pageContent = Buffer.concat([
    Buffer.from(
      `q\nBI\n/W ${Buffer.byteLength(eicar, 'ascii')}\n/H 1\n/BPC 8\n/CS /G\nID\n`,
      'ascii',
    ),
    Buffer.from(eicar, 'ascii'),
    Buffer.from('\nEI\nQ\n', 'ascii'),
  ]);
  const pageStream = document.context.flateStream(pageContent);
  page.node.addContentStream(document.context.register(pageStream));
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

async function pdfWithVisiblePageEicar() {
  const document = await PDFDocument.create();
  const page = document.addPage([600, 144]);
  const font = await document.embedFont(StandardFonts.Courier);
  page.drawText(eicar, { x: 12, y: 72, size: 9, font });
  return Buffer.from(await document.save());
}

async function pdfWithScannedPageText(text: string) {
  const canvas = createCanvas(6_000, 300);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 6_000, 300);
  context.fillStyle = '#000';
  context.font = '120px Arial';
  context.fillText(text, 20, 210);

  const document = await PDFDocument.create();
  const page = document.addPage([6_000, 300]);
  const image = await document.embedPng(canvas.toBuffer('image/png'));
  page.drawImage(image, { x: 0, y: 0, width: 6_000, height: 300 });
  return Buffer.from(await document.save());
}

async function pdfWithSmallImagePage() {
  const canvas = createCanvas(20, 20);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 20, 20);
  const document = await PDFDocument.create();
  const page = document.addPage([300, 144]);
  const image = await document.embedPng(canvas.toBuffer('image/png'));
  page.drawImage(image, { x: 0, y: 0, width: 20, height: 20 });
  return Buffer.from(await document.save());
}

describe('document malware scan', () => {
  it('distinguishes bytes in an inline image stream from visible page text', async () => {
    const inspected = await new PdfContentInspectionService().inspect(
      await pdfWithPageContentEicar(),
    );
    expect(inspected.pageCount).toBe(1);
    expect(inspected.text.toString('ascii')).not.toContain(eicar);
  });

  it('rejects OCR output above the inspection limit instead of truncating its tail', async () => {
    const fakeWorker = {
      recognize: vi.fn().mockResolvedValue({
        data: { text: `${'A'.repeat(4 * 1024 * 1024)}${eicar}` },
      }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    class OverflowOcrInspector extends PdfContentInspectionService {
      protected override async createOcrWorker() {
        return fakeWorker as never;
      }
    }

    await expect(
      new OverflowOcrInspector().inspect(await pdfWithSmallImagePage()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(fakeWorker.recognize).toHaveBeenCalledOnce();
    expect(fakeWorker.terminate).toHaveBeenCalledOnce();
  }, 30_000);

  it('skips scanning only for the disposable local Supabase test environment', async () => {
    const service = new DocumentScannerService(
      config({ SUPABASE_ENVIRONMENT: 'test', SUPABASE_LOCAL: true }),
    );
    await expect(service.assertClean(Buffer.from('synthetic test file'))).resolves.toBeUndefined();
  });

  it('uses the configured scanner even when the Supabase endpoints are local test services', async () => {
    const localScanner = await scanner('stream: OK\0');
    try {
      const service = new DocumentScannerService(
        config({
          SUPABASE_ENVIRONMENT: 'test',
          SUPABASE_LOCAL: true,
          CLAMAV_HOST: '127.0.0.1',
          CLAMAV_PORT: localScanner.port,
          CLAMAV_TIMEOUT_MS: 2_000,
        }),
      );
      await expect(service.assertClean(Buffer.from('document'))).resolves.toBeUndefined();
      expect(localScanner.requests()).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        localScanner.server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('fails closed when no scanner is configured outside local test', async () => {
    const service = new DocumentScannerService(
      config({ SUPABASE_ENVIRONMENT: 'staging', SUPABASE_LOCAL: false }),
    );
    await expect(service.assertClean(Buffer.from('document'))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('streams the file to ClamAV and accepts a clean result', async () => {
    const localScanner = await scanner('stream: OK\0');
    try {
      const service = new DocumentScannerService(
        config({
          SUPABASE_ENVIRONMENT: 'staging',
          SUPABASE_LOCAL: false,
          CLAMAV_HOST: '127.0.0.1',
          CLAMAV_PORT: localScanner.port,
          CLAMAV_TIMEOUT_MS: 2_000,
        }),
      );
      await expect(service.assertClean(Buffer.alloc(128_000, 7))).resolves.toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) =>
        localScanner.server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('rejects files reported as infected by ClamAV', async () => {
    const localScanner = await scanner('stream: Eicar-Signature FOUND\0');
    try {
      const service = new DocumentScannerService(
        config({
          SUPABASE_ENVIRONMENT: 'staging',
          SUPABASE_LOCAL: false,
          CLAMAV_HOST: '127.0.0.1',
          CLAMAV_PORT: localScanner.port,
          CLAMAV_TIMEOUT_MS: 2_000,
        }),
      );
      await expect(
        service.assertClean(Buffer.from('synthetic infected test')),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    } finally {
      await new Promise<void>((resolve, reject) =>
        localScanner.server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('fails closed when PDF extraction rejects malformed content', async () => {
    const localScanner = await scanner('stream: OK\0');
    try {
      const service = new DocumentScannerService(
        config({
          SUPABASE_ENVIRONMENT: 'staging',
          SUPABASE_LOCAL: true,
          CLAMAV_HOST: '127.0.0.1',
          CLAMAV_PORT: localScanner.port,
          CLAMAV_TIMEOUT_MS: 2_000,
        }),
      );
      await expect(
        service.assertClean(Buffer.from('%PDF-invalid'), 'application/pdf'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(localScanner.requests()).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        localScanner.server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('fails closed when PDF.js/OCR inspection cannot complete', async () => {
    const localScanner = await scanner('stream: OK\0');
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 144]);
    const bytes = Buffer.from(await pdf.save());
    const inspector = {
      inspect: vi.fn().mockRejectedValue(new ServiceUnavailableException('inspection failed')),
    };
    try {
      const service = new DocumentScannerService(
        config({
          SUPABASE_ENVIRONMENT: 'staging',
          SUPABASE_LOCAL: true,
          CLAMAV_HOST: '127.0.0.1',
          CLAMAV_PORT: localScanner.port,
          CLAMAV_TIMEOUT_MS: 2_000,
        }),
        inspector as never,
      );
      await expect(service.assertClean(bytes, 'application/pdf')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(inspector.inspect).toHaveBeenCalledWith(bytes);
      expect(localScanner.requests()).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        localScanner.server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('fails closed on a scanner response timeout', async () => {
    const silentConnections: Array<{ destroy: () => void }> = [];
    const silentScanner = createServer((socket) => {
      silentConnections.push(socket);
      socket.on('data', () => undefined);
    });
    await new Promise<void>((resolve) => silentScanner.listen(0, '127.0.0.1', resolve));
    const address = silentScanner.address() as AddressInfo;
    try {
      const service = new DocumentScannerService(
        config({
          SUPABASE_ENVIRONMENT: 'staging',
          SUPABASE_LOCAL: true,
          CLAMAV_HOST: '127.0.0.1',
          CLAMAV_PORT: address.port,
          CLAMAV_TIMEOUT_MS: 25,
        }),
      );
      await expect(
        service.assertClean(Buffer.from('synthetic timeout probe')),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      for (const socket of silentConnections) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        silentScanner.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('extracts and scans a PDF EmbeddedFile even if ClamAV reports the PDF itself clean', async () => {
    const localScanner = await scanner((file) =>
      file.subarray(0, 5).toString('ascii') === '%PDF-'
        ? 'stream: OK\0'
        : file.equals(Buffer.from(eicar, 'ascii'))
          ? 'stream: Eicar-Signature FOUND\0'
          : 'stream: OK\0',
    );
    try {
      const service = new DocumentScannerService(
        config({
          SUPABASE_ENVIRONMENT: 'staging',
          SUPABASE_LOCAL: true,
          CLAMAV_HOST: '127.0.0.1',
          CLAMAV_PORT: localScanner.port,
          CLAMAV_TIMEOUT_MS: 2_000,
        }),
      );
      await expect(
        service.assertClean(await pdfWithEmbeddedEicar(), 'application/pdf'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(localScanner.requests()).toBe(2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        localScanner.server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('scans PDF.js-extracted visible page text after the original and decoded stream', async () => {
    const pagePdf = await pdfWithVisiblePageEicar();
    expect(pagePdf.includes(Buffer.from(eicar, 'ascii'))).toBe(false);
    const decodedStreams = await extractPdfScanTargets(pagePdf);
    expect(decodedStreams.pageContents.length).toBeGreaterThan(0);
    expect(
      decodedStreams.pageContents.some((stream) =>
        stream
          .toString('latin1')
          .includes(Buffer.from(eicar, 'ascii').toString('hex').toUpperCase()),
      ),
    ).toBe(true);
    const inspected = await new PdfContentInspectionService().inspect(pagePdf);
    expect(inspected.text.toString('utf8')).toContain(eicar);

    const localScanner = await scanner((file) =>
      file.toString('ascii').includes(eicar) && !file.includes(Buffer.from('Tj'))
        ? 'stream: Eicar-Signature FOUND\0'
        : 'stream: OK\0',
    );
    try {
      const service = new DocumentScannerService(
        config({
          SUPABASE_ENVIRONMENT: 'staging',
          SUPABASE_LOCAL: true,
          CLAMAV_HOST: '127.0.0.1',
          CLAMAV_PORT: localScanner.port,
          CLAMAV_TIMEOUT_MS: 2_000,
        }),
      );
      await expect(service.assertClean(pagePdf, 'application/pdf')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(localScanner.requests()).toBe(3);
      expect(localScanner.files()[0]?.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(localScanner.files()[1]?.toString('latin1')).toContain('Tj');
      expect(localScanner.files()[2]?.toString('ascii')).toContain(eicar);
      expect(localScanner.files()[2]?.toString('ascii')).not.toContain('Tj');
    } finally {
      await new Promise<void>((resolve, reject) =>
        localScanner.server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('OCR-extracts a scanned EICAR page and sends that text to ClamAV', async () => {
    const localScanner = await scanner((file) =>
      file.equals(Buffer.from(eicar, 'ascii')) ? 'stream: Eicar-Signature FOUND\0' : 'stream: OK\0',
    );
    try {
      const service = new DocumentScannerService(
        config({
          SUPABASE_ENVIRONMENT: 'staging',
          SUPABASE_LOCAL: true,
          CLAMAV_HOST: '127.0.0.1',
          CLAMAV_PORT: localScanner.port,
          CLAMAV_TIMEOUT_MS: 2_000,
        }),
      );
      await expect(
        service.assertClean(await pdfWithScannedPageText(eicar), 'application/pdf'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(localScanner.files()[0]?.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(localScanner.files().at(-2)?.toString('ascii')).toContain(
        'EICAR-STANDARD-ANTIVIRUS-TEST-FILE',
      );
      expect(localScanner.files().at(-1)).toEqual(Buffer.from(eicar, 'ascii'));
    } finally {
      await new Promise<void>((resolve, reject) =>
        localScanner.server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 30_000);

  it('does not treat the EICAR name alone as an infected OCR signature', async () => {
    const localScanner = await scanner('stream: OK\0');
    try {
      const service = new DocumentScannerService(
        config({
          SUPABASE_ENVIRONMENT: 'staging',
          SUPABASE_LOCAL: true,
          CLAMAV_HOST: '127.0.0.1',
          CLAMAV_PORT: localScanner.port,
          CLAMAV_TIMEOUT_MS: 2_000,
        }),
      );
      await expect(
        service.assertClean(
          await pdfWithScannedPageText('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'),
          'application/pdf',
        ),
      ).resolves.toBeUndefined();
      expect(localScanner.files()).toHaveLength(3);
    } finally {
      await new Promise<void>((resolve, reject) =>
        localScanner.server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 30_000);
});
