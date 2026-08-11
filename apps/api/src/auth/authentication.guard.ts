import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ApiEnvironment, AuthenticatedActor, PermissionCode } from '@livio/shared';
import type { RequestWithActor } from '../common/request-with-actor';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_ROUTE_KEY } from './public.decorator';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  private readonly supabase: SupabaseClient;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<ApiEnvironment, true>,
    private readonly prisma: PrismaService,
  ) {
    this.supabase = createClient(
      config.get('SUPABASE_URL', { infer: true }),
      config.get('SUPABASE_ANON_KEY', { infer: true }),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithActor>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Autenticação necessária');

    const { data, error } = await this.supabase.auth.getUser(token);
    if (error || !data.user) throw new UnauthorizedException('Sessão inválida ou expirada');

    const selectedOrganization = request.headers['x-organization-id'];
    const organizationId = Array.isArray(selectedOrganization)
      ? selectedOrganization[0]
      : selectedOrganization;
    const memberships = await this.prisma.organizationMember.findMany({
      where: {
        profileId: data.user.id,
        status: 'ACTIVE',
        ...(organizationId ? { organizationId } : {}),
        organization: { status: 'ACTIVE' },
        user: { status: 'ACTIVE', deletedAt: null },
      },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        clientId: true,
        roles: {
          select: {
            role: {
              select: {
                permissions: {
                  select: { permission: { select: { resource: true, action: true } } },
                },
              },
            },
          },
        },
      },
      take: 2,
    });
    const membership = memberships[0];
    if (!membership || memberships.length !== 1) {
      throw new UnauthorizedException(
        memberships.length > 1
          ? 'Selecione uma organização válida'
          : 'Usuário sem vínculo ativo com esta organização',
      );
    }

    const permissions = membership.roles.flatMap(({ role }) =>
      role.permissions.map(
        ({ permission }) => `${permission.resource}:${permission.action}` as PermissionCode,
      ),
    );
    const actor: AuthenticatedActor = {
      profileId: data.user.id,
      membershipId: membership.id,
      userId: membership.userId,
      organizationId: membership.organizationId,
      permissions: [...new Set(permissions)],
      ...(membership.clientId ? { clientId: membership.clientId } : {}),
    };
    request.actor = actor;
    return true;
  }
}
