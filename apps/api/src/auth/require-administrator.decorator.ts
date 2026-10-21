import { SetMetadata } from '@nestjs/common';

export const REQUIRED_ADMINISTRATOR_KEY = 'requiredAdministrator';
export const RequireAdministrator = () => SetMetadata(REQUIRED_ADMINISTRATOR_KEY, true);
