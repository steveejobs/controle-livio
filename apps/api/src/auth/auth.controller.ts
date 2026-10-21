import { createHash } from 'node:crypto';
import {
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@livio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentActor } from './current-actor.decorator';
import { AuthenticatedRoute } from './authenticated-route.decorator';

function accessEventId(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

@ApiTags('Autenticação')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @AuthenticatedRoute()
  async me(@CurrentActor() actor: AuthenticatedActor) {
    if (!actor.membershipId || !actor.profileId) {
      throw new UnauthorizedException('Contexto de membership inválido');
    }
    const membership = await this.prisma.organizationMember.findUniqueOrThrow({
      where: { id: actor.membershipId },
      include: { profile: true, organization: true },
    });
    return {
      user: {
        id: actor.userId,
        profileId: actor.profileId,
        name: membership.profile.fullName,
        email: membership.profile.email,
        clientId: membership.clientId,
        permissions: actor.permissions,
        isAdministrator: actor.isAdministrator ?? false,
      },
      organization: {
        id: membership.organization.id,
        name: membership.organization.tradeName ?? membership.organization.legalName,
        slug: membership.organization.slug,
      },
      membershipId: membership.id,
    };
  }

  @Post('access')
  @AuthenticatedRoute()
  async recordAccess(
    @CurrentActor() actor: AuthenticatedActor,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const accessKey = actor.sessionId ?? idempotencyKey;
    if (!accessKey || accessKey.length > 160)
      throw new BadRequestException('Não foi possível identificar esta sessão de acesso');
    const id = accessEventId(`${actor.organizationId}:${actor.userId}:${accessKey}`);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.activityEvent.createMany({
        data: [
          {
            id,
            organizationId: actor.organizationId,
            actorUserId: actor.userId,
            type: 'SYSTEM_ACCESS',
            subjectType: 'user',
            subjectId: actor.userId,
            summary: 'Acesso autenticado ao sistema',
          },
        ],
        skipDuplicates: true,
      }),
      this.prisma.user.update({
        where: { id: actor.userId },
        data: { lastLoginAt: now },
      }),
    ]);
    return { recorded: true };
  }
}
