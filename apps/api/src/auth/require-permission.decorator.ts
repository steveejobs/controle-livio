import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@livio/shared';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';
export const RequirePermission = (permission: PermissionCode) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);
