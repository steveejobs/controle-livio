import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { HealthStatus } from '@livio/shared';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live(): HealthStatus {
    return { status: 'ok', service: 'livio-api', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  async ready(): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', service: 'livio-api', timestamp: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException('Banco de dados indisponível');
    }
  }
}
