import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { RequestWithActor } from '../common/request-with-actor';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const actor = context.switchToHttp().getRequest<RequestWithActor>().actor;
    return actor ? this.tenantContext.run(actor, () => next.handle()) : next.handle();
  }
}
