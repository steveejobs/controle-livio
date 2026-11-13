// Writer unit tests isolate the persistence contract. These are NOT PostgreSQL,
// Storage or crash-recovery proofs; the real recovery service has separate tests.
import type { UploadPlan, UploadTicket } from './storage-recovery.service';

export function recoveryWriterDouble(
  storage: {
    upload?: (...args: unknown[]) => unknown;
    remove?: (...args: unknown[]) => unknown;
  } = {},
) {
  const plans = new Map<string, UploadPlan>(),
    stored = new Set<string>();
  const plan = async (input: UploadPlan) => {
    const ticket = {
      id: String(plans.size),
      organizationId: input.organizationId,
      ownerToken: 'unit-only',
    };
    plans.set(ticket.id, input);
    return ticket;
  };
  return {
    plan,
    planInTransaction: async (_tx: unknown, input: UploadPlan) => plan(input),
    store: async (ticket: UploadTicket, bytes: Buffer, mime: string, scan: () => Promise<void>) => {
      await scan();
      const p = plans.get(ticket.id)!;
      await storage.upload?.(p.key, bytes, mime, p.bucket);
      stored.add(ticket.id);
    },
    complete: async () => {},
    lockForAttachment: async () => {},
    retire: async () => null,
    releaseSigningGroup: async () =>
      [...plans].map(([id, p]) => ({
        id,
        organizationId: p.organizationId,
        ownerToken: 'unit-only',
      })),
    compensate: async (ticket: UploadTicket) => {
      if (stored.has(ticket.id)) {
        const p = plans.get(ticket.id)!;
        await storage.remove?.(p.key, p.bucket);
      }
    },
  };
}
