import Decimal from 'decimal.js';

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_EVEN });

export type Money = string;

export function normalizeMoney(value: Money): Money {
  const amount = new Decimal(value);
  if (!amount.isFinite()) throw new Error('Valor monetário inválido');
  return amount.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2);
}

export function sumMoney(values: readonly Money[]): Money {
  return normalizeMoney(
    values.reduce((total, value) => total.plus(value), new Decimal(0)).toFixed(),
  );
}

export function remainingAllocation(paymentAmount: Money, allocations: readonly Money[]): Money {
  const remaining = new Decimal(paymentAmount).minus(sumMoney(allocations));
  if (remaining.isNegative()) throw new Error('Alocações excedem o valor do pagamento');
  return normalizeMoney(remaining.toFixed());
}
