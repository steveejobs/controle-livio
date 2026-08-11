import { describe, expect, it, vi } from 'vitest';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('persiste estado anterior, posterior, ator e sessão no mesmo transaction client', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit-a' });
    const transaction = { auditLog: { create } };
    await new AuditService().record(transaction as never, {
      organizationId: 'org-a',
      actorUserId: 'user-a',
      actorSessionId: 'session-a',
      action: 'UPDATE',
      resource: 'matter',
      resourceId: 'matter-a',
      before: { status: 'LEAD' },
      after: { status: 'ACTIVE' },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-a',
        actorUserId: 'user-a',
        actorSessionId: 'session-a',
        before: { status: 'LEAD' },
        after: { status: 'ACTIVE' },
      }),
    });
  });
});
