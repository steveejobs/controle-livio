import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ServiceCatalogService } from './service-catalog.service';

const actor = { userId: 'user-a', sessionId: 'session-a', organizationId: 'org-a' } as const;

describe('ServiceCatalogService', () => {
  it('lists only services from the current organization', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ServiceCatalogService(
      { serviceCatalogItem: { findMany } } as never,
      { record: vi.fn() } as never,
    );

    await expect(service.list(actor)).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a' },
      orderBy: [{ area: 'asc' }, { name: 'asc' }],
    });
  });

  it('normalizes, persists and audits a reusable organization service', async () => {
    const item = {
      id: 'service-a',
      organizationId: 'org-a',
      name: 'Plantão criminal',
      normalizedName: 'plantao criminal',
      area: 'CRIMINAL',
    };
    const create = vi.fn().mockResolvedValue(item);
    const record = vi.fn().mockResolvedValue(undefined);
    const transaction = { serviceCatalogItem: { create } };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const service = new ServiceCatalogService(prisma as never, { record } as never);

    await expect(
      service.create(actor, { name: ' Plantão   criminal ', area: 'CRIMINAL' }),
    ).resolves.toEqual(item);
    expect(create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-a',
        name: 'Plantão criminal',
        normalizedName: 'plantao criminal',
        area: 'CRIMINAL',
      },
    });
    expect(record).toHaveBeenCalledWith(transaction, {
      organizationId: 'org-a',
      actorUserId: 'user-a',
      actorSessionId: 'session-a',
      action: 'CREATE',
      resource: 'service_catalog_item',
      resourceId: 'service-a',
      after: item,
    });
  });

  it('does not allow saving a duplicate of a built-in service', async () => {
    const transaction = vi.fn();
    const service = new ServiceCatalogService(
      { $transaction: transaction } as never,
      { record: vi.fn() } as never,
    );

    await expect(
      service.create(actor, { name: ' ACOMPANHAMENTO EM DELEGACIA ', area: 'CRIMINAL' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
