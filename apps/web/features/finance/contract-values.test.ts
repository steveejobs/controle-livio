import { describe, expect, it } from 'vitest';
import {
  feeModelLabel,
  formatSuccessRate,
  normalizeMoneyInput,
  percentageToRate,
} from './contract-values';

describe('contract form values', () => {
  it('normalizes Brazilian money and rejects ambiguous input', () => {
    expect(normalizeMoneyInput('1.500,00')).toBe('1500.00');
    expect(() => normalizeMoneyInput('1.5.00')).toThrow('Informe um valor válido');
  });

  it('converts an entered success percentage to the API decimal format', () => {
    expect(percentageToRate('15')).toBe('0.150000');
    expect(percentageToRate('12,5')).toBe('0.125000');
    expect(percentageToRate('100')).toBe('1.000000');
    expect(() => percentageToRate('100,01')).toThrow('não pode superar 100%');
  });

  it('formats stored rates as percentages without floating point arithmetic', () => {
    expect(formatSuccessRate('0.150000')).toBe('15');
    expect(formatSuccessRate('0.125000')).toBe('12.5');
    expect(formatSuccessRate('1.000000')).toBe('100');
    expect(formatSuccessRate(undefined)).toBe('—');
  });

  it('shows a readable fee model name', () => {
    expect(feeModelLabel('MIXED')).toBe('Misto');
    expect(feeModelLabel('NEW_MODEL')).toBe('NEW_MODEL');
  });
});
