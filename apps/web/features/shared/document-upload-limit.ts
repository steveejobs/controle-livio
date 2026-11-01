import { MAX_DOCUMENT_UPLOAD_SIZE_MB } from '@livio/shared';

export const MAX_DOCUMENT_UPLOAD_SIZE_BYTES = MAX_DOCUMENT_UPLOAD_SIZE_MB * 1024 * 1024;

export function getDocumentUploadSizeError(sizeBytes: number): string | undefined {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1)
    return 'O arquivo está vazio ou possui tamanho inválido.';
  if (sizeBytes > MAX_DOCUMENT_UPLOAD_SIZE_BYTES)
    return `O arquivo excede o limite de ${MAX_DOCUMENT_UPLOAD_SIZE_MB} MiB.`;
  return undefined;
}
