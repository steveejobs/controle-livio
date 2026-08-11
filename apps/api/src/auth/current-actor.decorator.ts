import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedActor } from '@livio/shared';
import type { RequestWithActor } from '../common/request-with-actor';

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedActor => {
    const actor = context.switchToHttp().getRequest<RequestWithActor>().actor;
    if (!actor) throw new Error('Ator autenticado ausente');
    return actor;
  },
);
