import { createServer, type AddressInfo } from 'node:net';
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DocumentScannerService } from './document-scanner.service';

function config(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as never;
}

async function scanner(reply: string) {
  const server = createServer((socket) => {
    let input = Buffer.alloc(0);
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
        input = input.subarray(4 + length);
        if (length === 0) {
          socket.end(reply);
          return;
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return { server, port: address.port };
}

describe('document malware scan', () => {
  it('skips scanning only for the disposable local Supabase test environment', async () => {
    const service = new DocumentScannerService(
      config({ SUPABASE_ENVIRONMENT: 'test', SUPABASE_LOCAL: true }),
    );
    await expect(service.assertClean(Buffer.from('synthetic test file'))).resolves.toBeUndefined();
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
});
