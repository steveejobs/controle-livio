import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@livio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class ScheduledDispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<ApiEnvironment, true>,
    private readonly notifications: NotificationsService,
  ) {}

  async run(timestamp?: string, signature?: string) {
    const secret = this.config.get('CRON_SECRET', { infer: true });
    if (!secret) throw new ServiceUnavailableException('Rotina automática não configurada');
    if (
      !timestamp ||
      !/^\d{10,12}$/.test(timestamp) ||
      !signature ||
      !/^[a-f0-9]{64}$/.test(signature)
    )
      throw new UnauthorizedException('Assinatura da rotina inválida');
    const age = Date.now() / 1000 - Number(timestamp);
    if (age > 90 || age < -10) throw new UnauthorizedException('Assinatura da rotina expirada');
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}:notifications-dispatch`)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      throw new UnauthorizedException('Assinatura da rotina inválida');
    const scheduledAt = new Date(Number(timestamp) * 1000);
    const claimed = await this.prisma.$queryRaw<Array<{ job_name: string }>>`
      INSERT INTO scheduled_job_state (job_name, last_scheduled_at)
      VALUES ('notifications', ${scheduledAt})
      ON CONFLICT (job_name) DO UPDATE SET last_scheduled_at = EXCLUDED.last_scheduled_at
      WHERE scheduled_job_state.last_scheduled_at < EXCLUDED.last_scheduled_at
      RETURNING job_name`;
    if (!claimed.length) return { duplicate: true };
    try {
      const result = await this.notifications.dispatchScheduledAlerts();
      await this.prisma
        .$executeRaw`UPDATE scheduled_job_state SET last_completed_at = CURRENT_TIMESTAMP WHERE job_name = 'notifications'`;
      return result;
    } catch (error) {
      await this.prisma
        .$executeRaw`UPDATE scheduled_job_state SET last_failed_at = CURRENT_TIMESTAMP WHERE job_name = 'notifications'`;
      throw error;
    }
  }
}
