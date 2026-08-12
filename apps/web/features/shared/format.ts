export const formatDate = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'medium',
        timeZone: 'America/Sao_Paulo',
      }).format(new Date(value))
    : '—';

export const formatMoney = (value?: string, code = 'BRL') =>
  value
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code }).format(Number(value))
    : '—';

export function decimalToCents(value: string): bigint {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error('Informe um valor válido.');
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function centsToDecimal(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

export function splitAmount(total: string, entry: string, installmentCount: number): string[] {
  const totalCents = decimalToCents(total);
  const entryCents = entry.trim() ? decimalToCents(entry) : 0n;
  if (entryCents > totalCents) throw new Error('A entrada não pode superar o valor total.');
  if (installmentCount < 1) throw new Error('Informe ao menos uma parcela.');
  const remaining = totalCents - entryCents;
  const count = BigInt(installmentCount);
  const base = remaining / count;
  const remainder = remaining % count;
  const values = Array.from({ length: installmentCount }, (_, index) =>
    centsToDecimal(base + (BigInt(index) < remainder ? 1n : 0n)),
  );
  return entryCents > 0n ? [centsToDecimal(entryCents), ...values] : values;
}

export function addMonths(dateValue: string, months: number): string {
  const [year, month, day] = dateValue.split('-').map(Number);
  if (!year || !month || !day) throw new Error('Informe uma data válida.');
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}
