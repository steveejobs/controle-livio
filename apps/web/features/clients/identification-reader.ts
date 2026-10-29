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

function nextValue(lines: string[], index: number, label: RegExp): string | undefined {
  let inline = cleanLine(lines[index]!.replace(label, '').replace(/^[:;\-.\s]+/, ''));
  const nextLabel = inline.search(
    /\b(?:CPF|RG|REGISTRO GERAL|IDENTIDADE|NASCIMENTO|DATA DE NASCIMENTO|FILIA[CÇ][AÃ]O)\b/i,
  );
  if (nextLabel >= 0) inline = cleanLine(inline.slice(0, nextLabel));
  if (
    inline &&
    !/^(CPF|RG|REGISTRO GERAL|NASCIMENTO|DATA DE NASCIMENTO|FILIA[CÇ][AÃ]O)\b/i.test(inline)
  )
    return inline;
  const following = lines.slice(index + 1, index + 3).find((line) => {
    const candidate = cleanLine(line);
    return (
      candidate &&
      !/^(CPF|RG|REGISTRO GERAL|NASCIMENTO|DATA DE NASCIMENTO|FILIA[CÇ][AÃ]O|NOME)\b/i.test(
        candidate,
      )
    );
  });
  return following ? cleanLine(following) : undefined;
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
  const nameIndex = lines.findIndex(
    (line) => /^NOME(?: COMPLETO)?\b/i.test(line) && !/^NOME (?:DO|DA)\b/i.test(line),
  );
  const name = nameIndex >= 0 ? nextValue(lines, nameIndex, /^NOME(?: COMPLETO)?\b/i) : undefined;

  const cpfIndex = lines.findIndex((line) => /\bCPF\b/i.test(line));
  const cpfFollowing = cpfIndex >= 0 ? lines[cpfIndex + 1] : undefined;
  const cpfScope =
    cpfIndex >= 0
      ? [
          lines[cpfIndex],
          ...(cpfFollowing &&
          !/^(?:RG|REGISTRO GERAL|IDENTIDADE|NASCIMENTO|DATA DE NASCIMENTO|FILIA[CÇ][AÃ]O)\b/i.test(
            cpfFollowing,
          )
            ? [cpfFollowing]
            : []),
        ].join(' ')
      : '';
  const cpfMatch =
    cpfScope.match(/(?:\d[\s.-]*){11,14}/) ??
    text.match(/\b\d{3}[.\s]\d{3}[.\s]\d{3}[-\s]\d{2}\b|\b\d{11}\b/);
  const cpf = cpfMatch?.[0].replace(/\D/g, '').slice(0, 11);

  const rgIndex = lines.findIndex((line) => /\b(?:RG|REGISTRO GERAL|IDENTIDADE)\b/i.test(line));
  const rgValue =
    rgIndex >= 0 ? nextValue(lines, rgIndex, /^(?:RG|REGISTRO GERAL|IDENTIDADE)\b/i) : undefined;
  const rg = rgValue?.match(/[A-Z0-9][A-Z0-9./-]{3,}/i)?.[0];

  const issuerLine = lines.find((line) => /\b(?:SSP|SESP|SDS|PC|IFP|DETRAN|IIRGD)\b/i.test(line));
  const issuingAuthority = issuerLine?.match(
    /\b(?:SSP|SESP|SDS|PC|IFP|DETRAN|IIRGD)(?:\s*[-/]\s*[A-Z]{2})?\b/i,
  )?.[0];

  const birthIndex = lines.findIndex((line) =>
    /\b(?:DATA DE NASCIMENTO|NASCIMENTO|NASC\.)\b/i.test(line),
  );
  const birthScope = birthIndex >= 0 ? lines.slice(birthIndex, birthIndex + 2).join(' ') : '';
  const birthDate = normalizeDate(birthScope);

  return {
    ...(name ? { name: name.slice(0, 200) } : {}),
    ...(cpf?.length === 11 ? { cpf } : {}),
    ...(rg ? { rg: rg.slice(0, 60) } : {}),
    ...(issuingAuthority ? { issuingAuthority } : {}),
    ...(birthDate ? { birthDate } : {}),
  };
}
