import { describe, expect, it } from 'vitest';
import { normalizeAndValidateTaxId } from './tax-id';

describe('CPF/CNPJ', () => {
  it('normaliza documentos válidos e rejeita dígitos inválidos', () => {
    expect(normalizeAndValidateTaxId('529.982.247-25')).toBe('52998224725');
    expect(normalizeAndValidateTaxId('04.252.011/0001-10')).toBe('04252011000110');
    expect(() => normalizeAndValidateTaxId('111.111.111-11')).toThrow(/CPF\/CNPJ/);
  });
});
