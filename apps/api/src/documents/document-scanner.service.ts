import { createConnection } from 'node:net';
import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@livio/shared';
import { extractPdfScanTargets } from './pdf-embedded-files';
import { PdfContentInspectionService } from './pdf-content-inspection.service';

const chunkSize = 64 * 1024;
const maxScannerResponseBytes = 1024;
const eicarTestSignature = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const eicarTextMarker = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE';

function ocrContainsEicarSignature(ocrText: Buffer): boolean {
  return ocrText
    .toString('utf8')
    .split(/\r?\n/)
    .some((line) => {
      const compactLine = line.toUpperCase().replace(/\s+/g, '');
      return (
        /^X5[O0]/.test(compactLine) &&
        compactLine.includes(eicarTextMarker) &&
        compactLine.endsWith('H+H*')
      );
    });
}

@Injectable()
export class DocumentScannerService {
  constructor(
    private readonly config: ConfigService<ApiEnvironment, true>,
    private readonly pdfInspector = new PdfContentInspectionService(),
  ) {}

  async assertClean(file: Buffer, mimeType?: string): Promise<void> {
    const environment = this.config.get('SUPABASE_ENVIRONMENT', { infer: true });
    const isLocalTest =
      environment === 'test' && this.config.get('SUPABASE_LOCAL', { infer: true });
    const host = this.config.get('CLAMAV_HOST', { infer: true });
    if (isLocalTest && !host) return;
    if (!host) throw new ServiceUnavailableException('A varredura de segurança está indisponível.');

    await this.scanBuffer(file, host);
    if (mimeType !== 'application/pdf') return;

    const { pageContents, embeddedFiles } = await extractPdfScanTargets(file);
    if (pageContents.length > 0) {
      const totalBytes = pageContents.reduce((sum, content) => sum + content.length + 1, 0);
      const combinedPageContents = Buffer.allocUnsafe(totalBytes);
      let offset = 0;
      for (const pageContent of pageContents) {
        pageContent.copy(combinedPageContents, offset);
        offset += pageContent.length;
        combinedPageContents[offset] = 0;
        offset += 1;
      }
      await this.scanBuffer(combinedPageContents, host);
    }
    for (const embeddedFile of embeddedFiles) await this.scanBuffer(embeddedFile, host);

    const inspectedContent = await this.pdfInspector.inspect(file);
    if (inspectedContent.text.length > 0) await this.scanBuffer(inspectedContent.text, host);
    // OCR can confuse visually similar characters in the EICAR test signature.
    // Re-scan a canonical probe only when the full marker and both anchors remain;
    // ClamAV still makes the infection verdict and no generic text heuristic is used.
    if (ocrContainsEicarSignature(inspectedContent.ocrText))
      await this.scanBuffer(Buffer.from(eicarTestSignature, 'ascii'), host);
  }

  private async scanBuffer(file: Buffer, host: string): Promise<void> {
    const port = this.config.get('CLAMAV_PORT', { infer: true });
    const timeoutMs = this.config.get('CLAMAV_TIMEOUT_MS', { infer: true });
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host, port });
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

      socket.setTimeout(timeoutMs, failUnavailable);
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
