import { Prisma } from '@livio/db';
import { createHash } from 'node:crypto';

export type FieldSource = 'PDF_TEXT' | 'OCR' | 'FINANCIAL_RECORD' | 'CALCULATION';
export type ExtractedField = { value: string; source: FieldSource; confidence: number };
export type ReceiptFields = Partial<
  Record<
    | 'documentType'
    | 'institution'
    | 'payer'
    | 'beneficiary'
    | 'taxId'
    | 'nominalAmount'
    | 'dueAmount'
    | 'paidAmount'
    | 'discount'
    | 'interest'
    | 'penalty'
    | 'issuedDate'
    | 'dueDate'
    | 'paidDate'
    | 'processedDate'
    | 'paidTime'
    | 'endToEndId'
    | 'transactionId'
    | 'digitableLine'
    | 'barcode'
    | 'documentNumber',
    ExtractedField
  >
>;

const money = String.raw`(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})`;
const date = String.raw`(\d{2}[\/-]\d{2}[\/-]\d{4}|\d{4}-\d{2}-\d{2})`;

export function decimalFromBrazilian(value: string): Prisma.Decimal | undefined {
  if (!/^(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}$/.test(value)) return undefined;
  return new Prisma.Decimal(value.replaceAll('.', '').replace(',', '.'));
}

export function brazilianDate(value: string): string | undefined {
  const match = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return brazilianDate(`${day}/${month}/${year}`);
  }
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  )
    return undefined;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function interpretReceiptText(
  text: string,
  source: 'PDF_TEXT' | 'OCR',
): {
  fields: ReceiptFields;
  warnings: string[];
} {
  const fields: ReceiptFields = {};
  const warnings: string[] = [];
  const normalized = text.normalize('NFC').replace(/\r/g, '').slice(0, 40_000);
  const confidence = source === 'PDF_TEXT' ? 0.88 : 0.62;
  const put = (key: keyof ReceiptFields, value: string | undefined, score = confidence) => {
    if (value) fields[key] = { value, source, confidence: score };
  };
  const matchLine = (pattern: RegExp) => normalized.match(pattern)?.[1]?.trim();
  const extractMoney = (label: string) => {
    const raw = matchLine(new RegExp(String.raw`(?:^|\n)\s*(?:${label})\s*[:-]?\s*${money}`, 'im'));
    return raw ? decimalFromBrazilian(raw)?.toFixed(2) : undefined;
  };
  const extractDate = (key: keyof ReceiptFields, label: string) => {
    const raw = matchLine(new RegExp(String.raw`(?:^|\n)\s*(?:${label})\s*[:-]?\s*${date}`, 'im'));
    if (!raw) return;
    const parsed = brazilianDate(raw);
    if (parsed) put(key, parsed);
    else warnings.push(`Data inválida no campo ${key}.`);
  };

  put(
    'paidAmount',
    extractMoney(
      'valor (?:efetivamente )?pago|valor da transa[cç][aã]o|valor transferido|total pago',
    ),
  );
  put(
    'dueAmount',
    extractMoney(
      'valor (?:total )?(?:devido|cobrado)|total da cobran[cç]a|valor a pagar|valor atualizado',
    ),
  );
  put('nominalAmount', extractMoney('valor (?:nominal|original|do documento|do boleto)'));
  put('discount', extractMoney('desconto(?:s)?'));
  put('interest', extractMoney('juros'));
  put('penalty', extractMoney('multa'));
  extractDate('issuedDate', 'data de emiss[aã]o|emiss[aã]o');
  extractDate('dueDate', 'data de vencimento|vencimento');
  extractDate('paidDate', 'data (?:do )?pagamento|pago em|data da transa[cç][aã]o');
  extractDate('processedDate', 'data de processamento|processado em');
  put(
    'paidTime',
    matchLine(
      /(?:^|\n)\s*(?:hor[aá]rio|hora da transa[cç][aã]o)\s*[:-]?\s*(\d{2}:\d{2}(?::\d{2})?)/im,
    ),
  );
  put(
    'endToEndId',
    matchLine(
      /(?:^|\n)\s*(?:id(?:entificador)?\s*(?:e2e|end.to.end)|endtoend(?:id)?)\s*[:-]?\s*([A-Za-z0-9]{15,40})/im,
    ),
  );
  put(
    'transactionId',
    matchLine(
      /(?:^|\n)\s*(?:id(?:entificador)?\s*(?:da\s*)?transa[cç][aã]o|autentica[cç][aã]o)\s*[:-]?\s*([A-Za-z0-9._:/-]{6,160})/im,
    ),
  );
  put(
    'documentNumber',
    matchLine(
      /(?:^|\n)\s*(?:n[uú]mero do documento|nosso n[uú]mero)\s*[:-]?\s*([A-Za-z0-9.-]{3,80})/im,
    ),
  );
  put(
    'digitableLine',
    matchLine(/(?:^|\n)\s*(?:linha digit[aá]vel)\s*[:-]?\s*([\d.\s]{40,80})/im)?.replaceAll(
      /\s/g,
      '',
    ),
  );
  put('barcode', matchLine(/(?:^|\n)\s*(?:c[oó]digo de barras)\s*[:-]?\s*(\d{44,48})/im));
  put(
    'institution',
    matchLine(/(?:^|\n)\s*(?:banco|institui[cç][aã]o(?: financeira)?)\s*[:-]?\s*([^\n]{2,120})/im),
  );
  put('payer', matchLine(/(?:^|\n)\s*(?:pagador|remetente)\s*[:-]?\s*([^\n]{2,160})/im));
  put(
    'beneficiary',
    matchLine(
      /(?:^|\n)\s*(?:benefici[aá]rio|recebedor|destinat[aá]rio)\s*[:-]?\s*([^\n]{2,160})/im,
    ),
  );
  put(
    'taxId',
    matchLine(/(?:^|\n)\s*(?:cpf|cnpj)\s*[:-]?\s*([\d.*/-]{11,20})/im),
    confidence * 0.8,
  );
  const type = /\bpix\b/i.test(normalized)
    ? 'PIX'
    : /\bboleto\b|linha digit[aá]vel/i.test(normalized)
      ? 'BOLETO'
      : /\btransfer[eê]ncia\b|\bTED\b/i.test(normalized)
        ? 'TRANSFERENCIA'
        : undefined;
  put('documentType', type);
  if (!fields.paidAmount)
    warnings.push('Valor efetivamente pago não identificado; revisão manual necessária.');
  if (!fields.paidDate)
    warnings.push('Data do pagamento não identificada; revisão manual necessária.');
  return { fields, warnings };
}

/**
 * O external_id de Payment tem unicidade por organização no PostgreSQL. A chave
 * opaca inclui a família do identificador; identificadores de cobrança (nosso
 * número/linha digitável) não são usados como identificadores de liquidação.
 */
export function financialTransactionExternalId(fields: ReceiptFields): string | undefined {
  const endToEndId = fields.endToEndId?.value.trim().normalize('NFC');
  let kind: string | undefined;
  let value: string | undefined;
  if (endToEndId) {
    kind = 'PIX_E2E';
    value = endToEndId;
  } else {
    const transactionId = fields.transactionId?.value.trim().normalize('NFC');
    const type = fields.documentType?.value;
    if (!transactionId) return undefined;
    if (type === 'PIX') kind = 'PIX_TRANSACTION';
    else if (type === 'TRANSFERENCIA') kind = 'TRANSFER_TRANSACTION';
    else if (type === 'BOLETO') kind = 'BOLETO_SETTLEMENT';
    else return undefined;
    const institution = fields.institution?.value
      .trim()
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('pt-BR');
    // Generic bank references are only safe inside the issuer's namespace.
    // Without an institution, leave this optional key unset instead of risking
    // a false duplicate across banks; identical uploads still use the receipt hash.
    if (!institution) return undefined;
    value = `${institution}\u0000${transactionId}`;
  }
  const digest = createHash('sha256').update(value).digest('hex');
  return `livio-receipt:v1:${kind}:${digest}`;
}

export function reconcileReceipt(input: {
  originalAmount: string;
  previousPaid: string;
  balance: string;
  dueDate: string;
  fields: ReceiptFields;
  today?: string;
}) {
  const decimal = (value: string) => new Prisma.Decimal(value);
  const original = decimal(input.originalAmount);
  const previous = decimal(input.previousPaid);
  const balance = decimal(input.balance);
  const paid = input.fields.paidAmount ? decimal(input.fields.paidAmount.value) : undefined;
  const nominal = input.fields.nominalAmount
    ? decimal(input.fields.nominalAmount.value)
    : undefined;
  const documentDue = input.fields.dueAmount ? decimal(input.fields.dueAmount.value) : undefined;
  const discount = input.fields.discount
    ? decimal(input.fields.discount.value)
    : new Prisma.Decimal(0);
  const interest = input.fields.interest
    ? decimal(input.fields.interest.value)
    : new Prisma.Decimal(0);
  const penalty = input.fields.penalty
    ? decimal(input.fields.penalty.value)
    : new Prisma.Decimal(0);
  const formulaExpected = nominal?.minus(discount).plus(interest).plus(penalty);
  const expected = formulaExpected ?? documentDue;
  const difference = paid && expected ? paid.minus(expected) : undefined;
  const dueAmountDifference =
    formulaExpected && documentDue ? documentDue.minus(formulaExpected) : undefined;
  // When the receipt carries an explicit payable amount, compare it to the live
  // ledger balance. A face value alone is compared only before any prior payment.
  const ledgerComparable = documentDue ?? (previous.isZero() ? formulaExpected : undefined);
  const ledgerDifference = ledgerComparable?.minus(balance);
  const warnings: string[] = [];
  const paidDate = input.fields.paidDate?.value;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  if (paidDate && paidDate > today) warnings.push('A data de pagamento está no futuro.');
  if (input.fields.dueDate && input.fields.dueDate.value !== input.dueDate)
    warnings.push('O vencimento do documento difere do registro financeiro.');
  if (dueAmountDifference && !dueAmountDifference.isZero())
    warnings.push(
      'O valor devido difere do valor calculado com valor nominal, desconto, juros e multa.',
    );
  if (ledgerDifference && !ledgerDifference.isZero())
    warnings.push('O valor da cobrança difere do saldo atual registrado no Lívio.');
  if (difference && !difference.isZero())
    warnings.push('O valor pago difere da cobrança indicada no documento.');
  if (paid?.greaterThan(balance))
    warnings.push('O valor informado excede o saldo; requer decisão autorizada.');
  const outcome =
    !paid || !paidDate
      ? 'INCONCLUSIVE'
      : paid.greaterThan(balance)
        ? 'EXCESS'
        : paid.equals(balance)
          ? 'FULL'
          : 'PARTIAL';
  const flags = [
    ...(paidDate && paidDate < input.dueDate ? ['EARLY'] : []),
    ...(paidDate && paidDate > input.dueDate ? ['LATE'] : []),
    ...(discount.isPositive() ? ['DISCOUNT'] : []),
    ...(interest.isPositive() ? ['INTEREST'] : []),
    ...(penalty.isPositive() ? ['PENALTY'] : []),
    ...(difference?.isNegative() ? ['INSUFFICIENT'] : []),
    ...(paid && paid.lessThan(balance) ? ['PARTIAL_PAYMENT'] : []),
    ...(difference && !difference.isZero() ? ['CHARGE_DIVERGENCE'] : []),
  ];
  return {
    originalAmount: original.toFixed(2),
    previousPaid: previous.toFixed(2),
    balanceBefore: balance.toFixed(2),
    paidAmount: paid?.toFixed(2) ?? null,
    expectedAmount: expected?.toFixed(2) ?? null,
    difference: difference?.toFixed(2) ?? null,
    dueAmountDifference: dueAmountDifference?.toFixed(2) ?? null,
    ledgerDifference: ledgerDifference?.toFixed(2) ?? null,
    balanceAfter: paid && !paid.greaterThan(balance) ? balance.minus(paid).toFixed(2) : null,
    dueDate: input.dueDate,
    paidDate: paidDate ?? null,
    timing: paidDate
      ? paidDate < input.dueDate
        ? 'EARLY'
        : paidDate > input.dueDate
          ? 'LATE'
          : 'ON_TIME'
      : null,
    outcome,
    flags,
    warnings,
    provenance: {
      originalAmount: 'FINANCIAL_RECORD',
      previousPaid: 'FINANCIAL_RECORD',
      balanceBefore: 'FINANCIAL_RECORD',
      dueDate: 'FINANCIAL_RECORD',
      expectedAmount: expected ? 'CALCULATION' : null,
      difference: difference ? 'CALCULATION' : null,
      balanceAfter: paid && !paid.greaterThan(balance) ? 'CALCULATION' : null,
    },
  };
}
