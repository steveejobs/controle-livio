import { describe, expect, it } from 'vitest';
import { createServiceCatalogItemSchema, paymentChangeSchema } from './finance.schemas';

const paymentChange = {
  reference: 'PIX-001',
  amount: '125.50',
  paidAt: '2026-10-20',
  method: 'PIX',
  externalId: null,
  allocations: [{ installmentId: '11111111-1111-4111-8111-111111111111', amount: '125.50' }],
  reason: 'Referência lançada incorretamente',
};

describe('paymentChangeSchema', () => {
  it('accepts a complete correction proposal with string money', () => {
    expect(paymentChangeSchema.safeParse(paymentChange).success).toBe(true);
  });

  it('rejects duplicate installment allocations', () => {
    const duplicate = {
      ...paymentChange,
      allocations: [...paymentChange.allocations, ...paymentChange.allocations],
    };
    expect(paymentChangeSchema.safeParse(duplicate).success).toBe(false);
  });

  it('rejects malformed money instead of coercing it through floating point', () => {
    expect(paymentChangeSchema.safeParse({ ...paymentChange, amount: 125.5 }).success).toBe(false);
  });
});

describe('createServiceCatalogItemSchema', () => {
  it('trims names and defaults services to the general legal area', () => {
    expect(createServiceCatalogItemSchema.parse({ name: '  Plantão criminal  ' })).toEqual({
      name: 'Plantão criminal',
      area: 'GENERAL',
    });
  });

  it('rejects unsupported service areas', () => {
    expect(
      createServiceCatalogItemSchema.safeParse({ name: 'Plantão criminal', area: 'CIVIL' }).success,
    ).toBe(false);
  });
});
