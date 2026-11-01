import { describe, expect, it, vi } from 'vitest';
import { ClientsService } from './clients.service';

describe('client photo transport limits', () => {
  it('rejects a PNG above 4 MiB before uploading or changing the database', async () => {
    const upload = vi.fn();
    const transaction = vi.fn();
    const service = new ClientsService(
      { $transaction: transaction } as never,
      {} as never,
      { upload } as never,
    );
    vi.spyOn(service, 'get').mockResolvedValue({ id: 'client-a' } as never);
    const buffer = Buffer.alloc(4 * 1024 * 1024 + 1);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer);
    await expect(
      service.uploadPhoto(
        { organizationId: 'org-a', userId: 'user-a', permissions: ['clients:update'] },
        'client-a',
        { buffer } as Express.Multer.File,
      ),
    ).rejects.toThrow('4 MiB');
    expect(upload).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('accepts the exact 4 MiB boundary and replaces the old object after the database commit', async () => {
    const calls: string[] = [];
    const updateMany = vi.fn().mockImplementation(async () => {
      calls.push('commit');
      return { count: 1 };
    });
    const storage = {
      upload: vi.fn().mockImplementation(async () => {
        calls.push('upload');
      }),
      remove: vi.fn().mockImplementation(async () => {
        calls.push('remove-old');
      }),
      signedUrl: vi.fn().mockResolvedValue('https://example.test/private-photo'),
    };
    const service = new ClientsService(
      {
        $transaction: async (action: (tx: unknown) => unknown) =>
          action({ client: { updateMany } }),
      } as never,
      { record: vi.fn() } as never,
      storage as never,
    );
    vi.spyOn(service, 'get').mockResolvedValue({
      id: 'client-a',
      photoStorageKey: 'old-private-key',
    } as never);
    const buffer = Buffer.alloc(4 * 1024 * 1024);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer);
    await expect(
      service.uploadPhoto(
        { organizationId: 'org-a', userId: 'user-a', permissions: ['clients:update'] },
        'client-a',
        { buffer } as Express.Multer.File,
      ),
    ).resolves.toEqual({ url: 'https://example.test/private-photo' });
    expect(calls).toEqual(['upload', 'commit', 'remove-old']);
    const uploaded = storage.upload.mock.calls[0]!;
    expect(uploaded[0]).toMatch(/^org-a\/clients\/client-a\/.+\.png$/);
    expect(uploaded[1]).toBe(buffer);
    expect(uploaded.slice(2)).toEqual(['image/png', 'client-photos']);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-a',
          deletedAt: null,
          photoStorageKey: 'old-private-key',
        }),
      }),
    );
    expect(storage.signedUrl).toHaveBeenCalledWith(expect.any(String), 300, 'client-photos');
  });

  it('removes only the newly uploaded object if a concurrent update wins', async () => {
    const storage = { upload: vi.fn(), remove: vi.fn(), signedUrl: vi.fn() };
    const service = new ClientsService(
      {
        $transaction: async (action: (tx: unknown) => unknown) =>
          action({ client: { updateMany: async () => ({ count: 0 }) } }),
      } as never,
      { record: vi.fn() } as never,
      storage as never,
    );
    vi.spyOn(service, 'get').mockResolvedValue({
      id: 'client-a',
      photoStorageKey: 'old-private-key',
    } as never);
    const buffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    await expect(
      service.uploadPhoto(
        { organizationId: 'org-a', userId: 'user-a', permissions: ['clients:update'] },
        'client-a',
        { buffer } as Express.Multer.File,
      ),
    ).rejects.toThrow('outra sessão');
    expect(storage.remove).toHaveBeenCalledExactlyOnceWith(
      storage.upload.mock.calls[0]![0],
      'client-photos',
    );
    expect(storage.remove).not.toHaveBeenCalledWith('old-private-key', expect.anything());
    expect(storage.signedUrl).not.toHaveBeenCalled();
  });

  it('denies a foreign client before reading, uploading or deleting Storage objects', async () => {
    const storage = { upload: vi.fn(), remove: vi.fn(), signedUrl: vi.fn() };
    const service = new ClientsService({} as never, {} as never, storage as never);
    vi.spyOn(service, 'get').mockRejectedValue(new Error('Cliente não encontrado'));
    const actor = { organizationId: 'org-a', userId: 'user-a', permissions: ['clients:update'] };
    await expect(service.photoUrl(actor, 'foreign-client')).rejects.toThrow(
      'Cliente não encontrado',
    );
    await expect(service.uploadPhoto(actor, 'foreign-client')).rejects.toThrow(
      'Cliente não encontrado',
    );
    await expect(service.removePhoto(actor, 'foreign-client')).rejects.toThrow(
      'Cliente não encontrado',
    );
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(storage.signedUrl).not.toHaveBeenCalled();
  });
});
