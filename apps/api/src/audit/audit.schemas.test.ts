import { describe, expect, it } from 'vitest';
import { auditQuerySchema } from './audit.schemas';

describe('filtros de atividades', () => {
  it('aceita datas reais em período crescente', () => {
    expect(
      auditQuerySchema.safeParse({ dateFrom: '2026-02-28', dateTo: '2026-03-01' }).success,
    ).toBe(true);
  });

  it('rejeita datas impossíveis e período invertido', () => {
    expect(auditQuerySchema.safeParse({ dateFrom: '2026-02-31' }).success).toBe(false);
    expect(
      auditQuerySchema.safeParse({ dateFrom: '2026-10-22', dateTo: '2026-10-21' }).success,
    ).toBe(false);
  });
});
