import {
  PayloadTooLargeException,
  ServiceUnavailableException,
  type CanActivate,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { finalize, type Observable } from 'rxjs';
import type { Request } from 'express';
import { DOCUMENT_UPLOAD_BUFFER_LIMITS } from './document-upload-limits';

const multipartEnvelopeAllowance = 128 * 1024;
export const DOCUMENT_UPLOAD_REQUEST_LIMIT_BYTES =
  DOCUMENT_UPLOAD_BUFFER_LIMITS.fileSize +
  DOCUMENT_UPLOAD_BUFFER_LIMITS.fields * DOCUMENT_UPLOAD_BUFFER_LIMITS.fieldSize +
  multipartEnvelopeAllowance;
export const DOCUMENT_UPLOAD_MAX_CONCURRENT_BUFFERS = 2;

export class DocumentUploadBodyLimitGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['content-length'];
    if (header === undefined) return true;

    const contentLength = Number(header);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0)
      throw new PayloadTooLargeException('Tamanho da requisição inválido.');
    if (contentLength > DOCUMENT_UPLOAD_REQUEST_LIMIT_BYTES)
      throw new PayloadTooLargeException('A requisição excede o limite de upload.');
    return true;
  }
}

export class DocumentUploadAdmissionInterceptor implements NestInterceptor {
  private activeBuffers = 0;

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.activeBuffers >= DOCUMENT_UPLOAD_MAX_CONCURRENT_BUFFERS)
      throw new ServiceUnavailableException(
        'O envio de documentos está temporariamente ocupado. Tente novamente em instantes.',
      );

    this.activeBuffers += 1;
    try {
      return next.handle().pipe(finalize(() => (this.activeBuffers -= 1)));
    } catch (error) {
      this.activeBuffers -= 1;
      throw error;
    }
  }
}
