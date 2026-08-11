import { normalizeDigits } from './security';

function allDigitsEqual(value: string): boolean {
  return /^([0-9])\1+$/.test(value);
}

function validCpf(value: string): boolean {
  if (value.length !== 11 || allDigitsEqual(value)) return false;
  const digits = [...value].map(Number);
  for (let position = 9; position < 11; position += 1) {
    const sum = digits
      .slice(0, position)
      .reduce((total, digit, index) => total + digit * (position + 1 - index), 0);
    const check = ((sum * 10) % 11) % 10;
    if (check !== digits[position]) return false;
  }
  return true;
}

function validCnpj(value: string): boolean {
  if (value.length !== 14 || allDigitsEqual(value)) return false;
  const digits = [...value].map(Number);
  const calculate = (length: number) => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = digits
      .slice(0, length)
      .reduce((total, digit, index) => total + digit * (weights[index] ?? 0), 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === digits[12] && calculate(13) === digits[13];
}

export function normalizeAndValidateTaxId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeDigits(value);
  if (!validCpf(normalized) && !validCnpj(normalized)) throw new Error('CPF/CNPJ inválido');
  return normalized;
}
