import { performance } from 'node:perf_hooks';
import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@livio/db';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ApiEnvironment, AuthenticatedActor, PermissionCode } from '@livio/shared';
import type { RequestWithActor } from '../common/request-with-actor';
import { recordRequestTiming } from '../common/request-timing';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_ROUTE_KEY } from './public.decorator';

const membershipSelect = {
  id: true,
  organizationId: true,
  userId: true,
  clientId: true,
  roles: {
    select: {
      role: {
        select: {
          key: true,
          permissions: {
            select: { permission: { select: { resource: true, action: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.OrganizationMemberSelect;

type MembershipWithPermissions = Prisma.OrganizationMemberGetPayload<{
  select: typeof membershipSelect;
}>;

@Injectable()
export class AuthenticationGuard implements CanActivate {
  private readonly supabase: SupabaseClient;
  private readonly membershipLookups = new Map<string, Promise<MembershipWithPermissions[]>>();

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

  private findMemberships(profileId: string, organizationId?: string) {
    const key = JSON.stringify([profileId, organizationId ?? null]);
    const inFlight = this.membershipLookups.get(key);
    if (inFlight) return inFlight;

    const lookup = this.prisma.organizationMember.findMany({
      where: {
        profileId,
        status: 'ACTIVE',
        ...(organizationId ? { organizationId } : {}),
        organization: { status: 'ACTIVE' },
        user: { status: 'ACTIVE', deletedAt: null },
      },
      select: membershipSelect,
      take: 2,
    });
    this.membershipLookups.set(key, lookup);
    void lookup.then(
      () => {
        if (this.membershipLookups.get(key) === lookup) this.membershipLookups.delete(key);
      },
      () => {
        if (this.membershipLookups.get(key) === lookup) this.membershipLookups.delete(key);
      },
    );
    return lookup;
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

    const claimsStartedAt = performance.now();
    const { data, error } = await this.supabase.auth.getClaims(token);
    recordRequestTiming(request, 'authClaims', performance.now() - claimsStartedAt);
    const profileId = data?.claims.sub;
    if (error || typeof profileId !== 'string') {
      throw new UnauthorizedException('Sessão inválida ou expirada');
    }

    const selectedOrganization = request.headers['x-organization-id'];
    const organizationId = Array.isArray(selectedOrganization)
      ? selectedOrganization[0]
      : selectedOrganization;
    const membershipStartedAt = performance.now();
    const memberships = await this.findMemberships(profileId, organizationId);
    recordRequestTiming(
      request,
      'membershipPrismaRoundtrip',
      performance.now() - membershipStartedAt,
    );
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
    const isAdministrator = membership.roles.some(({ role }) => role.key === 'administrator');
    const sessionId = data?.claims.session_id;
    const actor: AuthenticatedActor = {
      profileId,
      membershipId: membership.id,
      userId: membership.userId,
      organizationId: membership.organizationId,
      isAdministrator,
      ...(typeof sessionId === 'string' ? { sessionId } : {}),
      permissions: [...new Set(permissions)],
      ...(membership.clientId ? { clientId: membership.clientId } : {}),
    };
    request.actor = actor;
    return true;
  }
}
