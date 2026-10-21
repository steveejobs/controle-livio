import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedActor } from '@livio/shared';
import { AuthController } from './auth.controller';

describe('AuthController access history', () => {
  it('records each authenticated session once and updates the last login time', async () => {
    const prisma = {
      activityEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      user: { update: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const controller = new AuthController(prisma as never);
    const actor: AuthenticatedActor = {
      userId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      sessionId: '33333333-3333-4333-8333-333333333333',
      permissions: [],
    };

    await controller.recordAccess(actor);
    const firstEvent = prisma.activityEvent.createMany.mock.calls[0]?.[0];
    await controller.recordAccess(actor);
    const secondEvent = prisma.activityEvent.createMany.mock.calls[1]?.[0];

    expect(firstEvent.data[0].id).toBe(secondEvent.data[0].id);
    expect(firstEvent.data[0].type).toBe('SYSTEM_ACCESS');
    expect(firstEvent.data[0].actorUserId).toBe(actor.userId);
    expect(prisma.user.update).toHaveBeenCalledTimes(2);
  });
});
