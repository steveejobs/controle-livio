import { createConnection } from 'node:net';
import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@livio/shared';

const chunkSize = 64 * 1024;
const maxScannerResponseBytes = 1024;

@Injectable()
export class DocumentScannerService {
  constructor(private readonly config: ConfigService<ApiEnvironment, true>) {}

  async assertClean(file: Buffer): Promise<void> {
    const environment = this.config.get('SUPABASE_ENVIRONMENT', { infer: true });
    const isLocalTest =
      environment === 'test' && this.config.get('SUPABASE_LOCAL', { infer: true });
    if (isLocalTest) return;

    const host = this.config.get('CLAMAV_HOST', { infer: true });
    if (!host) throw new ServiceUnavailableException('A varredura de segurança está indisponível.');

    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({
        host,
        port: this.config.get('CLAMAV_PORT', { infer: true }),
      });
      let response = '';
      let settled = false;
      const failUnavailable = () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new ServiceUnavailableException('A varredura de segurança não respondeu.'));
      };
      const finishWithResponse = (value: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (/\bOK\s*$/.test(value)) {
          resolve();
        } else if (/\bFOUND\s*$/.test(value)) {
          reject(
            new UnprocessableEntityException(
              'O arquivo foi bloqueado pela verificação de segurança.',
            ),
          );
        } else {
          reject(
            new ServiceUnavailableException('A varredura de segurança não pôde ser concluída.'),
          );
        }
      };

      socket.setTimeout(this.config.get('CLAMAV_TIMEOUT_MS', { infer: true }), failUnavailable);
      socket.once('error', failUnavailable);
      socket.once('connect', () => {
        socket.write(Buffer.from('zINSTREAM\0', 'ascii'));
        for (let offset = 0; offset < file.length; offset += chunkSize) {
          const part = file.subarray(offset, Math.min(offset + chunkSize, file.length));
          const size = Buffer.allocUnsafe(4);
          size.writeUInt32BE(part.length);
          socket.write(size);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4));
      });
      socket.on('data', (chunk: Buffer) => {
        if (response.length + chunk.length > maxScannerResponseBytes) {
          failUnavailable();
          return;
        }
        response += chunk.toString('utf8');
        const terminator = response.indexOf('\0');
        if (terminator >= 0) finishWithResponse(response.slice(0, terminator));
        else if (response.includes('\n')) finishWithResponse(response.trim());
      });
      socket.once('end', () => {
        if (response) finishWithResponse(response.replace(/\0.*$/, '').trim());
        else failUnavailable();
      });
    });
  }
}
