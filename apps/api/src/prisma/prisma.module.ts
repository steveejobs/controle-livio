import { Global, Module } from '@nestjs/common';
import { OrganizationScope } from '../auth/organization-scope';
import { TenantContextService } from '../auth/tenant-context.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, TenantContextService, OrganizationScope],
  exports: [PrismaService, TenantContextService, OrganizationScope],
})
export class PrismaModule {}
