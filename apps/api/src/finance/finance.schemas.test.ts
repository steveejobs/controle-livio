import { describe, expect, it } from 'vitest';
import {
  createServiceCatalogItemSchema,
  createExpenseSchema,
  expenseListQuerySchema,
  expenseHistoryQuerySchema,
  expensePaymentSchema,
  expenseRejectionSchema,
  updateExpenseSchema,
  paymentChangeSchema,
} from './finance.schemas';

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

describe('schemas de despesas', () => {
  it('limita paginação do histórico de despesas', () => {
    expect(expenseHistoryQuerySchema.parse({})).toEqual({ page: 1, pageSize: 10 });
    expect(expenseHistoryQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });

  it('exige vencimento nas novas despesas e impede remover o vencimento na edição', () => {
    const expense = {
      description: 'Custas processuais',
      category: 'Custas',
      amount: '125.1234',
      incurredAt: '2026-10-20',
      dueDate: '2026-11-20',
    };
    expect(createExpenseSchema.safeParse(expense).success).toBe(true);
    expect(createExpenseSchema.safeParse({ ...expense, dueDate: undefined }).success).toBe(false);
    expect(updateExpenseSchema.safeParse({ dueDate: '2026-11-25' }).success).toBe(true);
    expect(updateExpenseSchema.safeParse({ dueDate: null }).success).toBe(false);
  });

  it('aceita pagamento com valor decimal em string e rejeita coerção numérica', () => {
    const payment = { amount: '125.1234', paidAt: '2026-10-27', method: 'PIX' };
    expect(expensePaymentSchema.safeParse(payment).success).toBe(true);
    expect(expensePaymentSchema.safeParse({ ...payment, amount: 125.12 }).success).toBe(false);
  });

  it('valida faixa temporal e motivo de rejeição explícito', () => {
    expect(expenseListQuerySchema.safeParse({ from: '2026-11-01', to: '2026-10-01' }).success).toBe(
      false,
    );
    expect(expenseRejectionSchema.safeParse({ reason: 'Comprovante incompleto' }).success).toBe(
      true,
    );
    expect(expenseRejectionSchema.safeParse({ reason: 'x' }).success).toBe(false);
  });
});
