import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionCode } from '@livio/shared';
import type { RequestWithActor } from '../common/request-with-actor';
import { AUTHENTICATED_ROUTE_KEY } from './authenticated-route.decorator';
import { PUBLIC_ROUTE_KEY } from './public.decorator';
import { REQUIRED_PERMISSION_KEY } from './require-permission.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<PermissionCode>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      const authenticatedOnly = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ROUTE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      const { actor } = context.switchToHttp().getRequest<RequestWithActor>();
      if (authenticatedOnly && actor) return true;
      throw new ForbiddenException('Rota sem política de autorização definida');
    }

    const { actor } = context.switchToHttp().getRequest<RequestWithActor>();
    if (!actor?.permissions.includes(required)) {
      throw new ForbiddenException('Permissão insuficiente');
    }
    return true;
  }
}
