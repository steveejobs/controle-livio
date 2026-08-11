import { Injectable } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class OrganizationScope {
  constructor(private readonly context: TenantContextService) {}

  where(): { organizationId: string } {
    return { organizationId: this.context.require().organizationId };
  }

  createData<T extends object>(data: T): T & { organizationId: string } {
    return { ...data, organizationId: this.context.require().organizationId };
  }

  assert(organizationId: string): void {
    if (organizationId !== this.context.require().organizationId) {
      throw new Error('Violação de isolamento entre organizações');
    }
  }
}
