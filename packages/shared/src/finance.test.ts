import { describe, expect, it } from 'vitest';
import {
  calculateOutstandingByCurrency,
  normalizeMoney,
  remainingAllocation,
  sumMoney,
} from './finance';

describe('finance helpers', () => {
  it('uses bankers rounding without binary floating point', () => {
    expect(normalizeMoney('10.005')).toBe('10.00');
    expect(normalizeMoney('10.015')).toBe('10.02');
  });

  it('sums and validates allocations precisely', () => {
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
    expect(remainingAllocation('100.00', ['30.00', '20.00'])).toBe('50.00');
    expect(() => remainingAllocation('10.00', ['10.01'])).toThrow(/excedem/);
  });

  it('calculates client balances with adjustments, allocations and canceled records excluded', () => {
    expect(
      calculateOutstandingByCurrency([
        {
          currency: 'BRL',
          status: 'OPEN',
          installments: [
            {
              amount: '100.0000',
              status: 'PARTIALLY_PAID',
              adjustments: [
                { amount: '5.5000', kind: 'INTEREST' },
                { amount: '2.2500', kind: 'DISCOUNT' },
              ],
              allocations: [{ amount: '25.0000' }],
            },
            {
              amount: '80.0000',
              status: 'RENEGOTIATED',
              adjustments: [],
              allocations: [],
            },
          ],
        },
        {
          currency: 'USD',
          status: 'OPEN',
          installments: [{ amount: '10.1250', status: 'OPEN', adjustments: [], allocations: [] }],
        },
        {
          currency: 'BRL',
          status: 'CANCELLED',
          installments: [{ amount: '200.0000', status: 'OPEN', adjustments: [], allocations: [] }],
        },
      ]),
    ).toEqual([
      { currency: 'BRL', amount: '78.2500' },
      { currency: 'USD', amount: '10.1250' },
    ]);
  });
});
