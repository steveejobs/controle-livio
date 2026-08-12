import { SetMetadata } from '@nestjs/common';

export const AUTHENTICATED_ROUTE_KEY = 'authenticated_route';

/** Marca uma rota que exige sessão válida, mas não uma permissão de negócio específica. */
export const AuthenticatedRoute = () => SetMetadata(AUTHENTICATED_ROUTE_KEY, true);
