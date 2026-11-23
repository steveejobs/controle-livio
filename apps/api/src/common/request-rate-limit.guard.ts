import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Injectable, HttpException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { ApiEnvironment } from '@livio/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestWithActor } from './request-with-actor';
import { recordRequestTiming } from './request-timing';

@Injectable()
export class RequestRateLimitGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<ApiEnvironment, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithActor>();
    const actor = request.actor;
    if (!actor) return true;
    const read = ['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const limit = this.config.get(read ? 'API_RATE_LIMIT_READ' : 'API_RATE_LIMIT_WRITE', {
      infer: true,
    });
    const keyHash = createHash('sha256')
      .update(`${actor.userId}:${read ? 'read' : 'write'}`)
      .digest('hex');
    const rateLimitStartedAt = performance.now();
    const [counter] = await this.prisma.$queryRaw<
      Array<{ request_count: number; retry_after: number }>
    >`
      INSERT INTO public.api_rate_limits (organization_id, key_hash, window_started_at, request_count)
      VALUES (${actor.organizationId}::uuid, ${keyHash}, date_trunc('minute', CURRENT_TIMESTAMP), 1)
      ON CONFLICT (organization_id, key_hash) DO UPDATE SET
        window_started_at = EXCLUDED.window_started_at,
        request_count = CASE WHEN api_rate_limits.window_started_at = EXCLUDED.window_started_at
          THEN LEAST(api_rate_limits.request_count + 1, 1000000) ELSE 1 END
      RETURNING request_count,
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM (date_trunc('minute', CURRENT_TIMESTAMP) + INTERVAL '1 minute' - CURRENT_TIMESTAMP))))::integer AS retry_after`;
    recordRequestTiming(
      request,
      'rateLimitPrismaRoundtrip',
      performance.now() - rateLimitStartedAt,
    );
    if (!counter)
      throw new HttpException('Não foi possível verificar o limite de solicitações', 503);
    const response = http.getResponse<Response>();
    response.setHeader('X-RateLimit-Limit', limit);
    response.setHeader('X-RateLimit-Remaining', Math.max(0, limit - counter.request_count));
    if (counter.request_count > limit) {
      response.setHeader('Retry-After', counter.retry_after);
      throw new HttpException(
        'Muitas solicitações. Aguarde alguns segundos e tente novamente.',
        429,
      );
    }
    return true;
  }
}
