export function normalizeMoneyInput(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
  if (!/^\d{1,15}(\.\d{1,4})?$/.test(normalized)) {
    throw new Error('Informe um valor válido, por exemplo 1.500,00.');
  }
  return normalized;
}

export function percentageToRate(value: string): string | undefined {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return undefined;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalized)) {
    throw new Error('Informe o percentual entre 0 e 100.');
  }
  const [whole, fraction = ''] = normalized.split('.');
  const hundredths = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (hundredths > 10_000n) throw new Error('O percentual não pode superar 100%.');
  const millionths = hundredths * 100n;
  return `${millionths / 1_000_000n}.${String(millionths % 1_000_000n).padStart(6, '0')}`;
}

export function formatSuccessRate(rate?: string): string {
  if (!rate || !/^\d(?:\.\d{1,6})?$/.test(rate)) return '—';
  const [whole, fraction = ''] = rate.split('.');
  const millionths = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  const percentage = millionths * 100n;
  const percentWhole = percentage / 1_000_000n;
  const percentFraction = String(percentage % 1_000_000n)
    .padStart(6, '0')
    .replace(/0+$/, '');
  return percentFraction ? `${percentWhole}.${percentFraction}` : String(percentWhole);
}

export function feeModelLabel(model: string): string {
  const labels: Record<string, string> = {
    FIXED: 'Valor fixo',
    HOURLY: 'Por hora',
    SUCCESS: 'Êxito',
    MIXED: 'Misto',
  };
  return labels[model] ?? model;
}
