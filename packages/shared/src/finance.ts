import Decimal from 'decimal.js';

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_EVEN });

export type Money = string;

export type OutstandingInstallment = {
  amount: Money;
  status: string;
  allocations: readonly { amount: Money }[];
  adjustments: readonly { amount: Money; kind: string }[];
};

export type OutstandingReceivable = {
  currency: string;
  status: string;
  installments: readonly OutstandingInstallment[];
};

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

export function calculateOutstandingByCurrency(receivables: readonly OutstandingReceivable[]) {
  const totals = new Map<string, Decimal>();
  for (const receivable of receivables) {
    if (['CANCELLED', 'WRITTEN_OFF'].includes(receivable.status)) continue;
    const currency = receivable.currency.toUpperCase();
    for (const installment of receivable.installments) {
      if (['CANCELLED', 'RENEGOTIATED'].includes(installment.status)) continue;
      const adjusted = installment.adjustments.reduce(
        (total, adjustment) =>
          ['DISCOUNT', 'REVERSAL'].includes(adjustment.kind)
            ? total.minus(adjustment.amount)
            : total.plus(adjustment.amount),
        new Decimal(installment.amount),
      );
      const balance = adjusted.minus(
        installment.allocations.reduce(
          (total, allocation) => total.plus(allocation.amount),
          new Decimal(0),
        ),
      );
      if (balance.greaterThan(0)) {
        totals.set(currency, (totals.get(currency) ?? new Decimal(0)).plus(balance));
      }
    }
  }
  return [...totals.entries()].map(([currency, amount]) => ({
    currency,
    amount: amount.toFixed(4),
  }));
}
