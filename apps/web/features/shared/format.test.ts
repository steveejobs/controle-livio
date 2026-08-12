import { describe, expect, it } from 'vitest';
import { addMonths, decimalToCents, splitAmount } from './format';

describe('valores monetários e parcelamento', () => {
  it('divide os centavos sem perder ou criar dinheiro', () => {
    const installments = splitAmount('1000,00', '', 3);

    expect(installments).toEqual(['333.34', '333.33', '333.33']);
    expect(installments.reduce((sum, value) => sum + decimalToCents(value), 0n)).toBe(100000n);
  });

  it('separa a entrada das demais parcelas', () => {
    expect(splitAmount('1000.00', '100,00', 3)).toEqual(['100.00', '300.00', '300.00', '300.00']);
  });

  it('trata entrada zero como ausência de entrada e preserva datas mensais', () => {
    expect(splitAmount('100,00', '0,00', 2)).toEqual(['50.00', '50.00']);
    expect(addMonths('2026-08-31', 1)).toBe('2026-09-30');
  });

  it('rejeita entrada superior ao total', () => {
    expect(() => splitAmount('100.00', '100.01', 2)).toThrow(/superar/);
  });
});
