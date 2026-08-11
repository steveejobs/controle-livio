import { Injectable } from '@nestjs/common';
import { OrganizationScope } from '../auth/organization-scope';
import { PrismaService } from '../prisma/prisma.service';

export interface DashboardSummary {
  activeClients: number;
  activeMatters: number;
  overdueReceivables: number;
  openTasks: number;
  generatedAt: string;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OrganizationScope,
  ) {}

  async summary(): Promise<DashboardSummary> {
    const tenant = this.scope.where();
    const [activeClients, activeMatters, overdueReceivables, openTasks] =
      await this.prisma.$transaction([
        this.prisma.client.count({ where: { ...tenant, deletedAt: null } }),
        this.prisma.matter.count({ where: { ...tenant, deletedAt: null, status: 'ACTIVE' } }),
        this.prisma.receivable.count({
          where: {
            ...tenant,
            status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
            dueDate: { lt: new Date() },
          },
        }),
        this.prisma.task.count({
          where: { ...tenant, deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] } },
        }),
      ]);
    return {
      activeClients,
      activeMatters,
      overdueReceivables,
      openTasks,
      generatedAt: new Date().toISOString(),
    };
  }
}
