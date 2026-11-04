import { describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_UPLOAD_SIZE_BYTES,
  getDocumentUploadSizeError,
} from './document-upload-limit';

describe('limite de envio de documentos', () => {
  it('aceita um arquivo de até 4 MiB', () => {
    expect(getDocumentUploadSizeError(MAX_DOCUMENT_UPLOAD_SIZE_BYTES)).toBeUndefined();
  });

  it('rejeita um arquivo um byte acima de 4 MiB', () => {
    expect(getDocumentUploadSizeError(MAX_DOCUMENT_UPLOAD_SIZE_BYTES + 1)).toContain('4 MiB');
  });

  it('rejeita arquivos vazios ou tamanhos inválidos', () => {
    expect(getDocumentUploadSizeError(0)).toBeDefined();
    expect(getDocumentUploadSizeError(Number.NaN)).toBeDefined();
  });
});
