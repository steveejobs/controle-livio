import { describe, expect, it } from 'vitest';
import type { AuthenticatedActor } from '@livio/shared';
import { OrganizationScope } from './organization-scope';
import { TenantContextService } from './tenant-context.service';

const actor: AuthenticatedActor = {
  userId: 'user-id',
  organizationId: 'organization-id',
  sessionId: 'session-id',
  permissions: [],
};

describe('OrganizationScope', () => {
  it('injects the organization in filters and writes', () => {
    const context = new TenantContextService();
    const scope = new OrganizationScope(context);
    context.run(actor, () => {
      expect(scope.where()).toEqual({ organizationId: 'organization-id' });
      expect(scope.createData({ title: 'Caso' })).toEqual({
        title: 'Caso',
        organizationId: 'organization-id',
      });
    });
  });

  it('rejects cross-organization access', () => {
    const context = new TenantContextService();
    const scope = new OrganizationScope(context);
    context.run(actor, () =>
      expect(() => scope.assert('another-organization')).toThrow(/isolamento/),
    );
  });
});
