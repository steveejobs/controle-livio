import { describe, expect, it } from 'vitest';
import { normalizeMoney, remainingAllocation, sumMoney } from './finance';

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
});
