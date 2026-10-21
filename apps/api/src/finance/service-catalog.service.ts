import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@livio/db';
import type { AuthenticatedActor } from '@livio/shared';
import { DEFAULT_LEGAL_SERVICES, normalizeLegalServiceName } from '@livio/shared';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateServiceCatalogItemInput } from './finance.schemas';

@Injectable()
export class ServiceCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(actor: AuthenticatedActor) {
    return this.prisma.serviceCatalogItem.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: [{ area: 'asc' }, { name: 'asc' }],
    });
  }

  async create(actor: AuthenticatedActor, input: CreateServiceCatalogItemInput) {
    const normalizedName = normalizeLegalServiceName(input.name);
    const isDefault = DEFAULT_LEGAL_SERVICES.some(
      (service) => normalizeLegalServiceName(service.name) === normalizedName,
    );
    if (isDefault) throw new ConflictException('Esse serviço já está disponível na lista');

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const item = await transaction.serviceCatalogItem.create({
          data: {
            organizationId: actor.organizationId,
            name: input.name.trim().replace(/\s+/g, ' '),
            normalizedName,
            area: input.area,
          },
        });
        await this.audit.record(transaction, {
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          actorSessionId: actor.sessionId,
          action: 'CREATE',
          resource: 'service_catalog_item',
          resourceId: item.id,
          after: item,
        });
        return item;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Esse serviço já foi salvo na lista');
      }
      throw error;
    }
  }
}
