import { createHash } from 'node:crypto';

export const recoveryStates = [
  'PLANNED',
  'UPLOADING',
  'OBJECT_CREATED',
  'ATTACHED',
  'COMPLETE',
  'COMPENSATION_REQUIRED',
  'RECONCILE_PENDING',
  'DELETING',
  'ABSENT',
  'RETAINED',
  'INCIDENT',
] as const;
export type RecoveryState = (typeof recoveryStates)[number];
export type RecoveryPurpose = 'DOCUMENT' | 'VERSION' | 'PHOTO' | 'SIGNATURE' | 'SIGNED_PDF';
export const recoveryBuckets = ['legal-documents', 'client-photos', 'document-signatures'] as const;
export type RecoveryBucket = (typeof recoveryBuckets)[number];
export const maxRecoveryAttempts = 8;
export const recoveryLeaseMs = 15 * 60 * 1000;
export const absenceRecheckMs = 24 * 60 * 60 * 1000;

const transitions: Record<RecoveryState, readonly RecoveryState[]> = {
  PLANNED: ['UPLOADING', 'COMPENSATION_REQUIRED', 'INCIDENT'],
  UPLOADING: ['OBJECT_CREATED', 'COMPENSATION_REQUIRED', 'INCIDENT'],
  OBJECT_CREATED: ['ATTACHED', 'COMPENSATION_REQUIRED', 'INCIDENT'],
  ATTACHED: ['COMPLETE', 'INCIDENT'],
  COMPLETE: ['RECONCILE_PENDING', 'RETAINED', 'INCIDENT'],
  COMPENSATION_REQUIRED: ['RECONCILE_PENDING', 'DELETING', 'RETAINED', 'ABSENT', 'INCIDENT'],
  RECONCILE_PENDING: ['DELETING', 'RETAINED', 'ABSENT', 'INCIDENT'],
  DELETING: ['RECONCILE_PENDING', 'ABSENT', 'INCIDENT'],
  ABSENT: ['RECONCILE_PENDING', 'INCIDENT'],
  RETAINED: ['RECONCILE_PENDING', 'INCIDENT'],
  INCIDENT: ['RECONCILE_PENDING', 'RETAINED'],
};

export function assertRecoveryTransition(from: string, to: RecoveryState): void {
  if (from === to) return;
  if (!transitions[from as RecoveryState]?.includes(to))
    throw new Error('STORAGE_RECOVERY_INVALID_TRANSITION');
}

export function recoveryDelayMs(attempt: number): number {
  return Math.min(24 * 60 * 60 * 1000, 30_000 * 2 ** Math.min(12, Math.max(0, attempt - 1)));
}

export function objectBelongsToOrganization(
  organizationId: string,
  bucket: string,
  key: string,
): boolean {
  if (
    !/^[a-f0-9-]{36}$/i.test(organizationId) ||
    key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
    key.includes('\\') ||
    [...key].some((character) => character.charCodeAt(0) < 32)
  )
    return false;
  if (bucket === 'client-photos') return key.startsWith(`${organizationId}/clients/`);
  return (
    ['legal-documents', 'document-signatures'].includes(bucket) &&
    key.startsWith(`organizations/${organizationId}/`)
  );
}

export function recoveryErrorCode(error: unknown, depth = 0): string {
  if (depth > 4) return 'PROVIDER_OR_TRANSACTION_FAILURE';
  const e = error as {
    code?: unknown;
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
    cause?: unknown;
  } | null;
  if (
    /^PROVIDER_(TIMEOUT|UNAVAILABLE|AUTHORIZATION|UPLOAD_UNCONFIRMED|OR_TRANSACTION_FAILURE)$/.test(
      String(e?.code),
    )
  )
    return String(e?.code);
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError' || e?.code === 'ETIMEDOUT')
    return 'PROVIDER_TIMEOUT';
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND'].includes(String(e?.code)))
    return 'PROVIDER_UNAVAILABLE';
  if ([401, 403].includes(Number(e?.statusCode ?? e?.status))) return 'PROVIDER_AUTHORIZATION';
  if (/^P\d{4}$/.test(String(e?.code))) return `SQL_${String(e?.code)}`;
  if (e?.cause && e.cause !== error) {
    const code = recoveryErrorCode(e.cause, depth + 1);
    if (code !== 'PROVIDER_OR_TRANSACTION_FAILURE') return code;
  }
  if (Number(e?.statusCode ?? e?.status) >= 500) return 'PROVIDER_UNAVAILABLE';
  return 'PROVIDER_OR_TRANSACTION_FAILURE';
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export type ObjectObservation =
  | { status: 'PRESENT'; sha256: string; size: number }
  | { status: 'ABSENT' }
  | { status: 'UNKNOWN'; code: string };

// An ABSENT row remains scheduled: an earlier timed-out upload can arrive late.
export function recoveryDecision(input: {
  references: number;
  foreignReference: boolean;
  legalHold: boolean;
  expectedSha256: string | null;
  observation: ObjectObservation;
  metadataPresent: boolean;
}): 'RETAIN' | 'REMOVE' | 'ABSENT' | 'RETRY' | 'INCIDENT' {
  if (input.foreignReference) return 'INCIDENT';
  if (input.observation.status === 'UNKNOWN') return 'RETRY';
  if (input.references || input.legalHold) {
    if (input.observation.status === 'ABSENT') return 'INCIDENT';
    return input.expectedSha256 && input.expectedSha256 !== input.observation.sha256
      ? 'INCIDENT'
      : 'RETAIN';
  }
  if (input.observation.status === 'ABSENT') return input.metadataPresent ? 'RETRY' : 'ABSENT';
  if (!input.expectedSha256 || input.expectedSha256 !== input.observation.sha256) return 'INCIDENT';
  return 'REMOVE';
}
