export type IdentificationData = {
  name?: string;
  cpf?: string;
  rg?: string;
  issuingAuthority?: string;
  birthDate?: string;
};

function cleanLine(value: string): string {
  return value
    .replace(/[|_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[:;\-.\s]+|[:;\-.\s]+$/g, '');
}

const fieldLabel =
  /\b(?:CPF|RG|REGISTRO GERAL|IDENTIDADE|NASCIMENTO|DATA DE NASCIMENTO|NASC\.|FILIA[CÇ][AÃ]O|EMISS[AÃ]O|VALIDADE|[OÓ]RG[AÃ]O|UF|NOME|SSP|SESP|SDS|PC|IFP|DETRAN|IIRGD)\b/i;

function nextValue(lines: string[], index: number, label: RegExp): string | undefined {
  const inline = cleanLine(lines[index]!.replace(label, ''));
  const boundary = inline.search(fieldLabel);
  const value = cleanLine(boundary >= 0 ? inline.slice(0, boundary) : inline);
  if (value) return value;
  // Never jump across another field to manufacture a missing value.
  const following = lines[index + 1];
  if (!following || fieldLabel.test(following)) return undefined;
  return cleanLine(following) || undefined;
}

function validCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  for (const length of [9, 10]) {
    const sum = [...value.slice(0, length)].reduce(
      (total, digit, index) => total + Number(digit) * (length + 1 - index),
      0,
    );
    if (((sum * 10) % 11) % 10 !== Number(value[length])) return false;
  }
  return true;
}

function normalizeDate(value: string): string | undefined {
  const match = value.match(/\b(\d{2})[./-](\d{2})[./-](\d{4})\b/);
  if (!match) return undefined;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  )
    return undefined;
  return `${year}-${month}-${day}`;
}

export function parseIdentificationText(text: string): IdentificationData {
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const nameLabel = /^NOME(?: COMPLETO| E SOBRENOME)?\b/i;
  const nameIndex = lines.findIndex(
    (line) => nameLabel.test(line) && !/^NOME (?:DO|DA)\b/i.test(line),
  );
  const nameValue = nameIndex >= 0 ? nextValue(lines, nameIndex, nameLabel) : undefined;
  const name = nameValue && /^[\p{L}][\p{L}\s.'’-]+$/u.test(nameValue) ? nameValue : undefined;
  const cpfIndex = lines.findIndex((line) => /\bCPF\b/i.test(line));
  const cpfValue = cpfIndex >= 0 ? nextValue(lines, cpfIndex, /^.*?\bCPF\b/i) : undefined;
  const cpfDigits = cpfValue && /^[\d.\s-]+$/.test(cpfValue) ? cpfValue.replace(/\D/g, '') : '';
  const cpf = validCpf(cpfDigits) ? cpfDigits : undefined;
  const rgLabel = /^(?:RG|REGISTRO GERAL|IDENTIDADE)\b/i;
  const rgIndex = lines.findIndex((line) => rgLabel.test(line));
  const rgValue = rgIndex >= 0 ? nextValue(lines, rgIndex, rgLabel) : undefined;
  const rgCandidate = rgValue?.match(/^[A-Z0-9][A-Z0-9./-]{3,}/i)?.[0];
  const rg =
    rgCandidate && /\d/.test(rgCandidate) && !/^\d{2}[./-]\d{2}[./-]\d{4}$/.test(rgCandidate)
      ? rgCandidate
      : undefined;
  const issuingAuthority = text.match(
    /\b(?:SSP|SESP|SDS|PC|IFP|DETRAN|IIRGD)(?:\s*[-/]\s*[A-Z]{2})?\b/i,
  )?.[0];
  const birthLabel = /^(?:DATA (?:DE )?NASCIMENTO|NASCIMENTO|NASC\.)/i;
  const birthIndex = lines.findIndex((line) => birthLabel.test(line));
  const birthValue = birthIndex >= 0 ? nextValue(lines, birthIndex, birthLabel) : undefined;
  const birthDate = birthValue ? normalizeDate(birthValue) : undefined;
  return {
    ...(name ? { name: name.slice(0, 200) } : {}),
    ...(cpf ? { cpf } : {}),
    ...(rg ? { rg: rg.slice(0, 60) } : {}),
    ...(issuingAuthority ? { issuingAuthority } : {}),
    ...(birthDate ? { birthDate } : {}),
  };
}
