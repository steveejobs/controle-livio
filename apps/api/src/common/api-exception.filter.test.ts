import { describe, expect, it } from 'vitest';
import { sanitizeRequestPath } from './api-exception.filter';

describe('API error path sanitization', () => {
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
