import type { PermissionCode } from './permissions';

export interface AuthenticatedActor {
  readonly userId: string;
  readonly profileId?: string;
  readonly organizationId: string;
  readonly membershipId?: string;
  readonly sessionId?: string;
  readonly clientId?: string;
  readonly permissions: readonly PermissionCode[];
}

export interface ApiErrorBody {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly timestamp: string;
  readonly path: string;
}

export interface HealthStatus {
  readonly status: 'ok' | 'unavailable';
  readonly service: string;
  readonly timestamp: string;
}
