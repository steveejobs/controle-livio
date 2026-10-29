import { GoneException, NotFoundException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { deflateSync } from 'node:zlib';
import type { AuthenticatedActor } from '@livio/shared';
import { describe, expect, it, vi } from 'vitest';
import { DocumentSigningService } from './document-signing.service';

const actor: AuthenticatedActor = {
  userId: 'user-a',
  organizationId: 'org-a',
  permissions: ['documents:create', 'clients:view'],
};

function pngCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(pngCrc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}

function signaturePng(): Buffer {
  const width = 48;
  const height = 14;
  const pixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    pixels.push(0);
    for (let x = 0; x < width; x += 1) {
      const mark = Math.abs(y - Math.floor(x / 4) - 3) < 2;
      pixels.push(23, 63, 56, mark ? 255 : 0);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('tEXt', Buffer.from(`Comment\0${'assinatura '.repeat(8)}`)),
    pngChunk('IDAT', deflateSync(Buffer.from(pixels))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('DocumentSigningService', () => {
  it('creates a one-use expiring link and stores only the token hash', async () => {
    const pdfVersion = { version: 4, mimeType: 'application/pdf', sha256: 'a'.repeat(64) };
    const requestCreate = vi
      .fn()
      .mockImplementation(async ({ data }) => ({ id: 'request-a', expiresAt: data.expiresAt }));
    const audit = { record: vi.fn() };
    const prisma = {
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'document-a',
          title: 'Contrato de honorários',
          currentVersion: 4,
          client: {
            id: 'client-a',
            type: 'PERSON',
            displayName: 'Marina Souza',
            email: 'marina@example.test',
            phone: '+5599999999999',
            customFields: {},
          },
          versions: [pdfVersion],
        }),
      },
      $transaction: vi.fn(async (operation: (transaction: unknown) => unknown) =>
        operation({ documentSigningRequest: { create: requestCreate } }),
      ),
    };
    const service = new DocumentSigningService(prisma as never, {} as never, audit as never);

    const result = await service.createRequest(actor, 'document-a', { expiresInDays: 7 });

    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(requestCreate.mock.calls[0]![0].data).toMatchObject({
      organizationId: 'org-a',
      documentId: 'document-a',
      sourceVersion: 4,
      signerName: 'Marina Souza',
    });
    expect(requestCreate.mock.calls[0]![0].data.tokenHash).not.toBe(result.token);
    expect(result.client).toMatchObject({ email: 'marina@example.test', phone: '+5599999999999' });
    expect(audit.record).toHaveBeenCalledOnce();
  });

  it('returns only the pinned PDF through a short-lived storage URL', async () => {
    const token = 'b'.repeat(64);
    const signedUrl = 'https://storage.example.test/temporary';
    const request = {
      id: 'request-a',
      organizationId: 'org-a',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      sourceVersion: 2,
      signerName: 'Marina Souza',
      document: { title: 'Procuração' },
      sourceDocumentVersion: {
        mimeType: 'application/pdf',
        storageKey: 'organizations/org-a/document.pdf',
        sha256: 'c'.repeat(64),
      },
    };
    const prisma = {
      documentSigningRequest: {
        findUnique: vi.fn().mockResolvedValue(request),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ request_count: 1 }]),
    };
    const storage = { signedUrl: vi.fn().mockResolvedValue(signedUrl) };
    const service = new DocumentSigningService(prisma as never, storage as never, {} as never);

    const result = await service.publicDetails(token);

    expect(result).toMatchObject({
      status: 'PENDING',
      documentTitle: 'Procuração',
      signerName: 'Marina Souza',
      sourceVersion: 2,
      sourceSha256: 'c'.repeat(64),
      documentUrl: signedUrl,
    });
    expect(storage.signedUrl).toHaveBeenCalledWith('organizations/org-a/document.pdf', 300);
  });

  it('appends signature evidence to an immutable copy and saves its hashes', async () => {
    const sourcePdf = await PDFDocument.create();
    sourcePdf.addPage();
    const sourceBytes = Buffer.from(await sourcePdf.save());
    const signature = signaturePng();
    const request = {
      id: 'request-a',
      organizationId: 'org-a',
      documentId: 'document-a',
      sourceVersion: 3,
      status: 'PENDING',
      signerName: 'Marina Souza',
      createdById: 'user-a',
      expiresAt: new Date(Date.now() + 60_000),
      document: {
        id: 'document-a',
        organizationId: 'org-a',
        title: 'Contrato de honorários',
        category: 'CONTRATO_HONORARIOS',
        clientId: 'client-a',
        matterId: null,
        contractId: 'contract-a',
      },
      sourceDocumentVersion: {
        storageKey: 'organizations/org-a/source.pdf',
        mimeType: 'application/pdf',
        sha256: 'a'.repeat(64),
      },
    };
    const documentCreate = vi.fn().mockResolvedValue({ id: 'created' });
    const transactionUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const audit = { record: vi.fn() };
    const prisma = {
      documentSigningRequest: {
        findUnique: vi.fn().mockResolvedValue(request),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ request_count: 1 }]),
      $transaction: vi.fn(async (operation: (transaction: unknown) => unknown) =>
        operation({
          document: { create: documentCreate },
          documentSigningRequest: { updateMany: transactionUpdate },
        }),
      ),
    };
    const uploads: Array<{ key: string; file: Buffer; bucket?: string }> = [];
    const storage = {
      download: vi.fn().mockResolvedValue(sourceBytes),
      upload: vi
        .fn()
        .mockImplementation(async (key: string, file: Buffer, _mime: string, bucket?: string) => {
          uploads.push({ key, file, bucket });
        }),
      remove: vi.fn(),
    };
    const service = new DocumentSigningService(prisma as never, storage as never, audit as never);

    const result = await service.sign('e'.repeat(64), {
      signerName: 'Marina Souza',
      consent: true,
      signature: `data:image/png;base64,${signature.toString('base64')}`,
    });

    const finalPdf = await PDFDocument.load(uploads[1]!.file);
    expect(result.status).toBe('SIGNED');
    expect(result.signedDocumentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(finalPdf.getPageCount()).toBe(2);
    expect(uploads).toHaveLength(2);
    expect(uploads[0]?.bucket).toBe('document-signatures');
    expect(transactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'request-a', status: 'PROCESSING' },
        data: expect.objectContaining({
          status: 'SIGNED',
          signatureSha256: expect.any(String),
          signedDocumentId: result.signedDocumentId,
        }),
      }),
    );
    expect(documentCreate.mock.calls[0]![0].data.id).toBe(result.signedDocumentId);
    expect(audit.record).toHaveBeenCalledOnce();
  });

  it('does not resolve malformed or expired public links', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = { documentSigningRequest: { findUnique } };
    const service = new DocumentSigningService(prisma as never, {} as never, {} as never);

    await expect(service.publicDetails('not-a-token')).rejects.toBeInstanceOf(NotFoundException);
    expect(findUnique).not.toHaveBeenCalled();

    findUnique.mockResolvedValue({
      id: 'request-expired',
      organizationId: 'org-a',
      status: 'EXPIRED',
      expiresAt: new Date(Date.now() - 1000),
      document: { title: 'Contrato' },
    });
    const withThrottle = new DocumentSigningService(
      {
        documentSigningRequest: { findUnique },
        $queryRaw: vi.fn().mockResolvedValue([{ request_count: 1 }]),
      } as never,
      {} as never,
      {} as never,
    );
    await expect(withThrottle.publicDetails('d'.repeat(64))).rejects.toBeInstanceOf(GoneException);
  });
});
