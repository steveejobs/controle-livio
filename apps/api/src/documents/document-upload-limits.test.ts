import { describe, expect, it } from 'vitest';
import { DOCUMENT_UPLOAD_BUFFER_LIMITS } from './documents.controller';

describe('document upload buffering limit', () => {
  it('rejects files above the business ceiling before buffering more than 20 MiB', () => {
    expect(DOCUMENT_UPLOAD_BUFFER_LIMITS).toEqual({
      fileSize: 20 * 1024 * 1024,
      files: 1,
    });
  });
});
