import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { REQUEST_LOG_REDACT_PATHS } from './request-log-redaction';

describe('request log redaction', () => {
  it('does not serialize public signing tokens embedded in request paths', () => {
    const output: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output.push(Buffer.from(chunk).toString('utf8'));
        callback();
      },
    });
    const logger = pino(
      {
        base: null,
        redact: { paths: [...REQUEST_LOG_REDACT_PATHS], censor: '[REDACTED]' },
      },
      stream,
    );
    const token = 'synthetic-public-signature-token';

    logger.info({
      req: {
        url: `/v1/public/signatures/${token}`,
        params: { path: ['public', 'signatures', token, 'sign'] },
        query: { token },
        headers: { authorization: 'Bearer synthetic-auth-token' },
      },
    });

    expect(output.join('')).not.toContain(token);
    expect(output.join('')).not.toContain('synthetic-auth-token');
    expect(output.join('')).toContain('[REDACTED]');
  });
});
