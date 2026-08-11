import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@livio/db';

export function positiveMoney(value: string | Prisma.Decimal): Prisma.Decimal {
  const amount = new Prisma.Decimal(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_EVEN);
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw new BadRequestException('Valor monetário deve ser positivo');
  }
  return amount;
}

export function paymentSummary(
  paymentAmount: string | Prisma.Decimal,
  allocations: readonly (string | Prisma.Decimal)[],
) {
  const amount = positiveMoney(paymentAmount);
  const allocated = allocations.reduce<Prisma.Decimal>(
    (total, value) => total.plus(positiveMoney(value)),
    new Prisma.Decimal(0),
  );
  if (allocated.greaterThan(amount))
    throw new BadRequestException('Alocações excedem o valor do pagamento');
  return { amount, allocated, unapplied: amount.minus(allocated) };
}

export function installmentStatus(
  balance: Prisma.Decimal,
  dueDate: Date,
  hasPayments: boolean,
  now = new Date(),
): 'PAID' | 'PARTIALLY_PAID' | 'OVERDUE' | 'OPEN' {
  if (balance.lessThanOrEqualTo(0)) return 'PAID';
  if (hasPayments) return 'PARTIALLY_PAID';
  return dueDate < now ? 'OVERDUE' : 'OPEN';
}

export function assertExactRenegotiation(
  outstanding: Prisma.Decimal,
  amounts: readonly (string | Prisma.Decimal)[],
): Prisma.Decimal {
  const result = amounts.reduce<Prisma.Decimal>(
    (total, value) => total.plus(positiveMoney(value)),
    new Prisma.Decimal(0),
  );
  if (!result.equals(outstanding))
    throw new BadRequestException('Novas parcelas devem totalizar exatamente o saldo renegociado');
  return result;
}
