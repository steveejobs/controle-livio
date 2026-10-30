import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AuthenticatedActor } from '@livio/shared';
import { describe, expect, it, vi } from 'vitest';
import { DocumentsService } from './documents.service';

const actor: AuthenticatedActor = {
  userId: 'user',
  sessionId: 'session',
  organizationId: 'org-a',
  clientId: 'client-a',
  permissions: [],
};

describe('documentos privados', () => {
  it.each([
    ['arquivo infectado', new UnprocessableEntityException('Arquivo de teste bloqueado')],
    ['scanner indisponível', new ServiceUnavailableException('Scanner de teste indisponível')],
  ])('%s não chega ao Storage nem cria metadados', async (_scenario, scannerError) => {
    const documentCreate = vi.fn();
    const transactionClient = {};
    const transaction = vi.fn(async (operation: (tx: unknown) => unknown) =>
      operation(transactionClient),
    );
    const prisma = { document: { create: documentCreate }, $transaction: transaction };
    const storage = { upload: vi.fn(), remove: vi.fn() };
    const auditRecord = vi.fn().mockResolvedValue(undefined);
    const audit = { record: auditRecord };
    const scanner = { assertClean: vi.fn().mockRejectedValue(scannerError) };
    const service = new DocumentsService(
      prisma as never,
      storage as never,
      audit as never,
      { get: vi.fn().mockReturnValue(4) } as never,
      {} as never,
      {} as never,
      scanner as never,
    );
    const bytes = Buffer.from('%PDF-1.7 synthetic QA document');

    await expect(
      service.create(actor, { title: 'Documento seguro de teste', visibility: 'INTERNAL' }, {
        originalname: 'qa-document.pdf',
        mimetype: 'application/pdf',
        size: bytes.length,
        buffer: bytes,
      } as Express.Multer.File),
    ).rejects.toBe(scannerError);

    expect(scanner.assertClean).toHaveBeenCalledWith(bytes, 'application/pdf');
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledOnce();
    expect(documentCreate).not.toHaveBeenCalled();
    expect(auditRecord).toHaveBeenCalledWith(
      transactionClient,
      expect.objectContaining({
        action: 'CREATE',
        resource: 'document_upload',
        after: expect.objectContaining({
          outcome: 'blocked',
          mimeType: 'application/pdf',
          sizeBytes: bytes.length,
        }),
      }),
    );
    expect(auditRecord.mock.calls[0]?.[1]).not.toHaveProperty('after.fileName');
  });

  it('não permite que o filtro da listagem substitua o cliente autenticado do portal', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = {
      document: { findMany, count },
      $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const service = new DocumentsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.list(actor, { clientId: 'outro-cliente', page: 1, pageSize: 25 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: actor.organizationId,
          clientId: actor.clientId,
          visibility: 'CLIENT',
        }),
      }),
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ clientId: actor.clientId }) }),
    );
  });
  it('inclui organização, cliente do portal e visibilidade no filtro', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { document: { findFirst } };
    const service = new DocumentsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.getDocument(actor, 'doc-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-a',
          clientId: 'client-a',
          visibility: 'CLIENT',
        }),
      }),
    );
  });

  it('não assina URL quando o documento não pertence ao tenant', async () => {
    const storage = { signedUrl: vi.fn() };
    const prisma = { document: { findFirst: vi.fn().mockResolvedValue(null) } };
    const service = new DocumentsService(
      prisma as never,
      storage as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.downloadUrl(actor, 'foreign-document')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storage.signedUrl).not.toHaveBeenCalled();
  });

  it('gera um rascunho interno, vinculado ao cliente e salvo no storage privado', async () => {
    const generatedActor: AuthenticatedActor = {
      ...actor,
      permissions: ['clients:view', 'documents:create'],
    };
    const client = {
      id: actor.clientId,
      type: 'PERSON',
      displayName: 'Cliente QA',
      legalName: null,
      taxIdNormalized: '52998224725',
      address: { street: 'Rua Central', number: '10', city: 'Balsas', state: 'MA' },
      customFields: {},
    };
    const documentFind = vi.fn().mockResolvedValue(null);
    const documentCreate = vi.fn().mockResolvedValue({
      id: 'generated-document',
      title: 'Gerado automaticamente · Declaração de hipossuficiência',
      status: 'DRAFT',
      versions: [{ id: 'version-1', sizeBytes: 4096n }],
    });
    const prisma = {
      client: { findFirst: vi.fn().mockResolvedValue(client) },
      document: { findFirst: documentFind },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) =>
        operation({ document: { create: documentCreate } }),
      ),
    };
    const storage = { upload: vi.fn().mockResolvedValue(undefined), remove: vi.fn() };
    const generator = {
      generate: vi.fn().mockResolvedValue(Buffer.from('PK\x03\x04mock')),
      generatePdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.7 mock')),
    };
    const settings = {
      forGeneration: vi.fn(),
      templateForGeneration: vi.fn().mockResolvedValue('Modelo de declaração'),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const config = { get: vi.fn().mockReturnValue(10) };
    const service = new DocumentsService(
      prisma as never,
      storage as never,
      audit as never,
      config as never,
      generator as never,
      settings as never,
      { assertClean: vi.fn() } as never,
    );
    const generatedResult = {
      id: 'generated-document',
      status: 'DRAFT',
      versions: [{ id: 'version-2', sizeBytes: String(Buffer.from('%PDF-1.7 mock').length) }],
    };
    vi.spyOn(service, 'addVersion').mockResolvedValue({ version: 2 } as never);
    vi.spyOn(service, 'getDocument').mockResolvedValue(generatedResult as never);

    const result = await service.generate(generatedActor, {
      clientId: actor.clientId!,
      category: 'HIPOSSUFICIENCIA',
    });

    expect(result.status).toBe('DRAFT');
    expect(result.versions?.[0]?.sizeBytes).toBe(String(Buffer.from('%PDF-1.7 mock').length));
    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^organizations\/org-a\/documents\/[0-9a-f-]{36}\//),
      Buffer.from('PK\x03\x04mock'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(documentCreate.mock.calls[0]![0].data).toMatchObject({
      clientId: actor.clientId,
      category: 'HIPOSSUFICIENCIA',
      visibility: 'INTERNAL',
      status: 'DRAFT',
    });
    expect(settings.templateForGeneration).toHaveBeenCalledWith('org-a', 'HIPOSSUFICIENCIA');
    expect(generator.generate).toHaveBeenCalledWith(
      'HIPOSSUFICIENCIA',
      client,
      expect.objectContaining({ template: 'Modelo de declaração' }),
    );
    expect(generator.generatePdf).toHaveBeenCalledWith(
      'HIPOSSUFICIENCIA',
      client,
      expect.objectContaining({ template: expect.any(String) }),
    );
    expect(audit.record).toHaveBeenCalledOnce();
  });

  it('nega a geração sem permissão de leitura dos dados usados no documento', async () => {
    const service = new DocumentsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.generate(actor, { clientId: actor.clientId!, category: 'HIPOSSUFICIENCIA' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
