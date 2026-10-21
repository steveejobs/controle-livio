import { describe, expect, it } from 'vitest';
import { formatTaxIdField } from './tax-id-format';

describe('formatTaxIdField', () => {
  it('applies CPF punctuation as digits are entered and limits the field', () => {
    expect(formatTaxIdField('52998224725', 'PERSON')).toBe('529.982.247-25');
    expect(formatTaxIdField('529982247250000', 'PERSON')).toBe('529.982.247-25');
  });

  it('applies CNPJ punctuation while keeping incomplete input editable', () => {
    expect(formatTaxIdField('04252011000110', 'COMPANY')).toBe('04.252.011/0001-10');
    expect(formatTaxIdField('04252011', 'COMPANY')).toBe('04.252.011');
  });
});
