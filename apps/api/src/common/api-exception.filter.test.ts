import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter, sanitizeRequestPath } from './api-exception.filter';

describe('API error path sanitization', () => {
  it('never copies exception secrets or financial payloads into logs or the response', () => {
    const error = vi.fn();
    const json = vi.fn();
    const response = { status: vi.fn().mockReturnValue({ json }) };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          originalUrl: '/v1/public/signatures/secret-signature/sign?token=secret-query',
          headers: {},
          id: 'correlation-id',
          log: { error },
        }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
    new ApiExceptionFilter().catch(
      new Error('secret-signature secret-query bank-account amount=1234.56'),
      host,
    );
    expect(error).toHaveBeenCalledWith(
      { requestId: 'correlation-id', statusCode: 500 },
      'Falha não tratada',
    );
    const serialized = JSON.stringify([error.mock.calls, json.mock.calls]);
    for (const secret of ['secret-signature', 'secret-query', 'bank-account', '1234.56']) {
      expect(serialized).not.toContain(secret);
    }
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
  });
  it('redacts public signature tokens and omits query strings', () => {
    expect(sanitizeRequestPath('/v1/public/signatures/synthetic-token/sign?return=secret')).toBe(
      '/v1/public/signatures/[REDACTED]/sign',
    );
  });

  it('preserves ordinary route paths', () => {
    expect(sanitizeRequestPath('/v1/clients/123/overview?limit=20')).toBe(
      '/v1/clients/123/overview',
    );
  });
});
