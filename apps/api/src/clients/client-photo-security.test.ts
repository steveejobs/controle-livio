import { expect, it, vi } from 'vitest';
import { ClientsService } from './clients.service';

it('never uploads or changes a client photo when the existing scanner rejects it', async () => {
  const storage = {
    upload: vi.fn().mockRejectedValue(new Error('UPLOAD_REACHED_BEFORE_SCANNER')),
  };
  const assertClean = vi.fn().mockRejectedValue(new Error('SYNTHETIC_SCANNER_REJECTION'));
  const service = new ClientsService(
    {} as never,
    {} as never,
    storage as never,
    { assertClean } as never,
  );
  vi.spyOn(service, 'get').mockResolvedValue({ id: 'synthetic-client' } as never);
  await expect(
    service.uploadPhoto(
      {
        userId: 'synthetic-user',
        organizationId: 'synthetic-org',
        permissions: ['clients:update'],
      },
      'synthetic-client',
      {
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
        mimetype: 'image/png',
      } as Express.Multer.File,
    ),
  ).rejects.toThrow('SYNTHETIC_SCANNER_REJECTION');
  expect(assertClean).toHaveBeenCalledOnce();
  expect(storage.upload).not.toHaveBeenCalled();
});
