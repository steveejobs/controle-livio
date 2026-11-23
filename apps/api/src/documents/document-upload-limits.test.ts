import { describe, expect, it } from 'vitest';
import { PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { Subject } from 'rxjs';
import { DOCUMENT_UPLOAD_BUFFER_LIMITS } from './documents.controller';
import {
  DocumentUploadAdmissionInterceptor,
  DocumentUploadBodyLimitGuard,
  DOCUMENT_UPLOAD_MAX_CONCURRENT_BUFFERS,
  DOCUMENT_UPLOAD_REQUEST_LIMIT_BYTES,
} from './document-upload-guards';

describe('document upload buffering limit', () => {
  it('caps file size, aggregate multipart fields and part count before buffering', () => {
    expect(DOCUMENT_UPLOAD_BUFFER_LIMITS).toEqual({
      fileSize: 4 * 1024 * 1024,
      files: 1,
      fields: 4,
      fieldSize: 2 * 1024,
      parts: 5,
      fieldNameSize: 64,
      headerPairs: 32,
    });
    expect(DOCUMENT_UPLOAD_REQUEST_LIMIT_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    expect(DOCUMENT_UPLOAD_MAX_CONCURRENT_BUFFERS).toBe(2);
  });

  it('rejects a declared aggregate body above the request limit', () => {
    const guard = new DocumentUploadBodyLimitGuard();
    const context = (contentLength?: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ headers: { 'content-length': contentLength } }),
        }),
      }) as never;

    expect(() =>
      guard.canActivate(context(String(DOCUMENT_UPLOAD_REQUEST_LIMIT_BYTES + 1))),
    ).toThrow(PayloadTooLargeException);
    expect(guard.canActivate(context(String(DOCUMENT_UPLOAD_REQUEST_LIMIT_BYTES)))).toBe(true);
    expect(guard.canActivate(context())).toBe(true);
  });

  it('limits concurrent in-memory upload pipelines and releases capacity on completion', () => {
    const interceptor = new DocumentUploadAdmissionInterceptor();
    const subject = new Subject<void>();
    const context = {} as never;
    const next = { handle: () => subject.asObservable() } as never;
    const first = interceptor.intercept(context, next).subscribe();
    const second = interceptor.intercept(context, next).subscribe();

    expect(() => interceptor.intercept(context, next)).toThrow(ServiceUnavailableException);
    subject.complete();
    first.unsubscribe();
    second.unsubscribe();
    const released = interceptor.intercept(context, next).subscribe();
    released.unsubscribe();
  });
});
