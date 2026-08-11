import { NotFoundException } from '@nestjs/common';
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
  it('inclui organização, cliente do portal e visibilidade no filtro', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { document: { findFirst } };
    const service = new DocumentsService(prisma as never, {} as never, {} as never, {} as never);
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
    );
    await expect(service.downloadUrl(actor, 'foreign-document')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storage.signedUrl).not.toHaveBeenCalled();
  });
});
