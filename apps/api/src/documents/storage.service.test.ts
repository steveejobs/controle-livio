import { describe, expect, it, vi } from 'vitest';
import { StorageService } from './storage.service';

describe('remoção compensatória do Storage', () => {
  it.each([true, false])('não oculta erro retornado pelo provedor: %s', async (failed) => {
    const remove = vi
      .fn()
      .mockResolvedValue({ error: failed ? { message: 'synthetic failure' } : null });
    const from = vi.fn(() => ({ remove }));
    const service = new StorageService({
      get: (name: string) =>
        ({
          STORAGE_BUCKET: 'legal-documents',
          SUPABASE_URL: 'http://127.0.0.1:54321',
          SUPABASE_SERVICE_ROLE_KEY: 'synthetic-local-only',
        })[name],
    } as never);
    Object.defineProperty(service, 'client', { value: { storage: { from } } });
    if (failed)
      await expect(service.remove('synthetic/private.pdf')).rejects.toThrow(
        'Falha ao remover documento privado',
      );
    else await expect(service.remove('synthetic/private.pdf')).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith('legal-documents');
    expect(remove).toHaveBeenCalledWith(['synthetic/private.pdf']);
  });
});
