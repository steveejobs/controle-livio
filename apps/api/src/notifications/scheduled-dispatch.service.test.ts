import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ScheduledDispatchService } from './scheduled-dispatch.service';

const secret = 'test-scheduled-dispatch-secret-for-validation';
function fixture() {
  const dispatchScheduledAlerts = vi.fn().mockResolvedValue({ hearings: { sent: 1 } });
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ job_name: 'notifications' }]),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const service = new ScheduledDispatchService(
    prisma as never,
    { get: () => secret } as never,
    { dispatchScheduledAlerts } as never,
  );
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}:notifications-dispatch`)
    .digest('hex');
  return { service, prisma, dispatchScheduledAlerts, timestamp, signature };
}

describe('agendamento assinado', () => {
  it('aceita a assinatura válida e registra conclusão', async () => {
    const { service, prisma, timestamp, signature, dispatchScheduledAlerts } = fixture();
    await expect(service.run(timestamp, signature)).resolves.toEqual({ hearings: { sent: 1 } });
    expect(dispatchScheduledAlerts).toHaveBeenCalledOnce();
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
  });
  it('nega assinatura ausente, inválida, expirada ou de outra finalidade antes de consultar o banco', async () => {
    const { service, prisma, timestamp, signature } = fixture();
    await expect(service.run()).rejects.toMatchObject({ status: 401 });
    await expect(service.run(timestamp, '0'.repeat(64))).rejects.toMatchObject({ status: 401 });
    await expect(service.run(String(Number(timestamp) - 120), signature)).rejects.toMatchObject({
      status: 401,
    });
    const other = createHmac('sha256', secret).update(`${timestamp}:other-action`).digest('hex');
    await expect(service.run(timestamp, other)).rejects.toMatchObject({ status: 401 });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('não executa novamente uma assinatura já consumida', async () => {
    const { service, prisma, timestamp, signature, dispatchScheduledAlerts } = fixture();
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(service.run(timestamp, signature)).resolves.toEqual({ duplicate: true });
    expect(dispatchScheduledAlerts).not.toHaveBeenCalled();
  });
});

describe('recovery signed dispatch isolation', () => {
  it('rejects the notification-purpose signature for recovery before SQL', async () => {
    const f = fixture();
    await expect(f.service.runRecovery(f.timestamp, f.signature)).rejects.toMatchObject({
      status: 401,
    });
    expect(f.prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('claims a distinct job, records failure and rejects replay', async () => {
    const prisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ job_name: 'storage_recovery' }])
        .mockResolvedValue([]),
      $executeRaw: vi.fn(),
    };
    const recoverDue = vi.fn().mockRejectedValue(new Error('RECOVERY_FAILED'));
    const service = new ScheduledDispatchService(
      prisma as never,
      { get: () => secret } as never,
      {} as never,
      { recoverDue } as never,
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', secret)
      .update(timestamp + ':storage-recovery-dispatch')
      .digest('hex');
    await expect(service.runRecovery(timestamp, signature)).rejects.toThrow('RECOVERY_FAILED');
    expect(prisma.$queryRaw.mock.calls[0]!.slice(1)).toContain('storage_recovery');
    expect(prisma.$executeRaw.mock.calls[0]![0].join('')).toContain('last_failed_at');
    expect(await service.runRecovery(timestamp, signature)).toEqual({ duplicate: true });
    expect(recoverDue).toHaveBeenCalledOnce();
  });
});
