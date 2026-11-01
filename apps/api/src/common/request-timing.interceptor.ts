import { performance } from 'node:perf_hooks';
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { finalize, type Observable } from 'rxjs';
import type { RequestWithActor } from './request-with-actor';
import { recordRequestTiming } from './request-timing';

@Injectable()
export class RequestTimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (process.env.QA_TIMINGS !== 'true') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithActor>();
    const response = http.getResponse<Response>();
    const startedAt = performance.now();
    return next.handle().pipe(
      finalize(() => {
        recordRequestTiming(request, 'handler', performance.now() - startedAt);
        const timing = Object.entries(request.qaTimings ?? {})
          .map(([name, duration]) => `${name};dur=${duration}`)
          .join(', ');
        if (timing) response.setHeader('Server-Timing', timing);
      }),
    );
  }
}
