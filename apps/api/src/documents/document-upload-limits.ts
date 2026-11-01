import { MAX_DOCUMENT_UPLOAD_SIZE_MB } from '@livio/shared';

export const DOCUMENT_UPLOAD_BUFFER_LIMITS = {
  fileSize: MAX_DOCUMENT_UPLOAD_SIZE_MB * 1024 * 1024,
  files: 1,
  fields: 4,
  fieldSize: 2 * 1024,
  parts: 5,
  fieldNameSize: 64,
  headerPairs: 32,
} as const;
