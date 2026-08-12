import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@livio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentActor } from './current-actor.decorator';
import { AuthenticatedRoute } from './authenticated-route.decorator';

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
      },
      organization: {
        id: membership.organization.id,
        name: membership.organization.tradeName ?? membership.organization.legalName,
        slug: membership.organization.slug,
      },
      membershipId: membership.id,
    };
  }
}
