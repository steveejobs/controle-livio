import { createServer, type AddressInfo } from 'node:net';
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { AFRelationship, PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { DocumentScannerService } from './document-scanner.service';

function config(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as never;
}

async function scanner(reply: string | ((file: Buffer) => string)) {
  let requests = 0;
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
          socket.end(typeof reply === 'string' ? reply : reply(file));
          return;
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return { server, port: address.port, requests: () => requests };
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
  const pageStream = document.context.flateStream(Buffer.from(`% ${eicar}\n`, 'ascii'));
  page.node.addContentStream(document.context.register(pageStream));
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

describe('document malware scan', () => {
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

  it('extracts and scans decoded page content when ClamAV does not inspect PDF page streams', async () => {
    const localScanner = await scanner((file) =>
      file.subarray(0, 5).toString('ascii') === '%PDF-' && !file.toString('ascii').includes(eicar)
        ? 'stream: OK\0'
        : file.toString('ascii').includes(eicar)
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
        service.assertClean(await pdfWithPageContentEicar(), 'application/pdf'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(localScanner.requests()).toBe(2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        localScanner.server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
