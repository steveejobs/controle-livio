import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { AuthenticatedActor } from '@livio/shared';

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<AuthenticatedActor>();

  run<T>(actor: AuthenticatedActor, callback: () => T): T {
    return this.storage.run(actor, callback);
  }

  require(): AuthenticatedActor {
    const actor = this.storage.getStore();
    if (!actor) throw new Error('Contexto de organização ausente');
    return actor;
  }
}
