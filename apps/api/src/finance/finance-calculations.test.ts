import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@livio/db';
import { describe, expect, it } from 'vitest';
import {
  assertExactRenegotiation,
  installmentStatus,
  paymentSummary,
  positiveMoney,
} from './finance-calculations';

describe('regras monetárias', () => {
  it('arredonda com HALF_EVEN sem ponto flutuante binário', () => {
    expect(positiveMoney('10.12345').toFixed(4)).toBe('10.1234');
    expect(positiveMoney('10.12355').toFixed(4)).toBe('10.1236');
  });

  it('trata pagamento parcial e múltiplas parcelas', () => {
    const result = paymentSummary('300.00', ['75.25', '124.75']);
    expect(result.allocated.toFixed(2)).toBe('200.00');
    expect(result.unapplied.toFixed(2)).toBe('100.00');
    expect(installmentStatus(new Prisma.Decimal('24.75'), new Date('2099-01-01'), true)).toBe(
      'PARTIALLY_PAID',
    );
  });

  it('preserva pagamento excedente como não alocado e bloqueia alocação excessiva', () => {
    expect(paymentSummary('120.00', ['100.00']).unapplied.toFixed(2)).toBe('20.00');
    expect(() => paymentSummary('99.99', ['100.00'])).toThrow(BadRequestException);
  });

  it('exige equivalência exata na renegociação', () => {
    expect(assertExactRenegotiation(new Prisma.Decimal('150.00'), ['50', '100']).toFixed(2)).toBe(
      '150.00',
    );
    expect(() => assertExactRenegotiation(new Prisma.Decimal('150.00'), ['149.99'])).toThrow(
      /exatamente/,
    );
  });
});
