import { describe, expect, it } from 'vitest';
import {
  brazilianDate,
  decimalFromBrazilian,
  financialTransactionExternalId,
  interpretReceiptText,
  reconcileReceipt,
} from './receipt-interpretation';

const pix = `Comprovante Pix\nBanco: Banco Sintético\nPagador: Pessoa de Teste\nBeneficiário: Escritório Fictício\nValor pago: R$ 33,34\nData do pagamento: 28/10/2026\nHorário: 14:35\nID E2E: E12345678202610281435ABCDEF123456`;
const boleto = `Boleto pago\nValor nominal: R$ 100,00\nDesconto: R$ 5,00\nJuros: R$ 1,25\nMulta: R$ 2,00\nValor pago: R$ 98,25\nData de vencimento: 20/10/2026\nData do pagamento: 21/10/2026\nLinha digitável: 00190.00009 01234.567890 12345.678901 1 12340000010000`;

describe('interpretação de comprovantes sintéticos em português', () => {
  it('lê Pix, valor pago, data e referência sem inventar campos ausentes', () => {
    const result = interpretReceiptText(pix, 'PDF_TEXT');
    expect(result.fields.documentType?.value).toBe('PIX');
    expect(result.fields.paidAmount?.value).toBe('33.34');
    expect(result.fields.paidDate?.value).toBe('2026-10-28');
    expect(result.fields.endToEndId?.value).toBe('E12345678202610281435ABCDEF123456');
    expect(financialTransactionExternalId(result.fields)).toMatch(/^livio-receipt:v1:PIX_E2E:/);
    expect(result.fields.nominalAmount).toBeUndefined();
    expect(result.fields.paidAmount?.source).toBe('PDF_TEXT');
  });

  it('lê cobrança de boleto e usa Decimal para desconto, juros e multa', () => {
    const result = interpretReceiptText(boleto, 'OCR');
    expect(result.fields.nominalAmount?.value).toBe('100.00');
    expect(result.fields.discount?.value).toBe('5.00');
    expect(result.fields.interest?.value).toBe('1.25');
    expect(result.fields.penalty?.value).toBe('2.00');
    const comparison = reconcileReceipt({
      originalAmount: '100.00',
      previousPaid: '0',
      balance: '100.00',
      dueDate: '2026-10-20',
      fields: result.fields,
      today: '2026-10-31',
    });
    expect(comparison.expectedAmount).toBe('98.25');
    expect(comparison.difference).toBe('0.00');
    expect(comparison.timing).toBe('LATE');
    expect(comparison.flags).toContain('DISCOUNT');
    expect(comparison.flags).toContain('INTEREST');
  });

  it('compara valor devido explícito, fórmula do boleto e saldo do Lívio sem confundir pagamento parcial', () => {
    const fields = interpretReceiptText(
      `Boleto
Valor nominal: R$ 100,00
Desconto: R$ 5,00
Juros: R$ 1,25
Multa: R$ 2,00
Valor devido: R$ 98,25
Valor pago: R$ 33,34
Data do pagamento: 29/10/2026`,
      'PDF_TEXT',
    ).fields;
    const partial = reconcileReceipt({
      originalAmount: '100.00',
      previousPaid: '0.00',
      balance: '100.00',
      dueDate: '2026-10-29',
      fields,
      today: '2026-10-31',
    });
    expect(partial.expectedAmount).toBe('98.25');
    expect(partial.difference).toBe('-64.91');
    expect(partial.dueAmountDifference).toBe('0.00');
    expect(partial.ledgerDifference).toBe('-1.75');
    expect(partial.outcome).toBe('PARTIAL');
    expect(partial.balanceAfter).toBe('66.66');
    expect(partial.flags).toContain('PARTIAL_PAYMENT');

    const contradictory = reconcileReceipt({
      originalAmount: '100.00',
      previousPaid: '0.00',
      balance: '100.00',
      dueDate: '2026-10-29',
      fields: { ...fields, dueAmount: { ...fields.dueAmount!, value: '97.25' } },
      today: '2026-10-31',
    });
    expect(contradictory.dueAmountDifference).toBe('-1.00');
    expect(contradictory.warnings).toContain(
      'O valor devido difere do valor calculado com valor nominal, desconto, juros e multa.',
    );
  });

  it('gera identificador bancário opaco, tipado e não inventa chave quando o tipo é desconhecido', () => {
    const transfer = interpretReceiptText(
      `Transferência
Banco: Banco Sintético
Valor pago: R$ 12,00
Data do pagamento: 29/10/2026
Identificador da transação: TX-ABC-123456`,
      'PDF_TEXT',
    ).fields;
    const key = financialTransactionExternalId(transfer);
    expect(key).toMatch(/^livio-receipt:v1:TRANSFER_TRANSACTION:[a-f0-9]{64}$/);
    expect(key).not.toContain('TX-ABC-123456');
    expect(
      financialTransactionExternalId({
        ...transfer,
        institution: { value: 'Banco Outro', source: 'PDF_TEXT', confidence: 0.88 },
      }),
    ).not.toBe(key);
    expect(financialTransactionExternalId({ ...transfer, institution: undefined })).toBeUndefined();
    expect(
      financialTransactionExternalId({
        ...transfer,
        documentType: { value: 'OUTRO', source: 'PDF_TEXT', confidence: 0.88 },
      }),
    ).toBeUndefined();
    expect(financialTransactionExternalId({})).toBeUndefined();
    expect(
      financialTransactionExternalId({
        transactionId: { value: 'TX-ABC-123456', source: 'PDF_TEXT', confidence: 0.88 },
        documentType: { value: 'BOLETO', source: 'PDF_TEXT', confidence: 0.88 },
      }),
    ).not.toBe(key);
  });

  it('interpreta transferência com data ISO e identifica insuficiência sem calcular saldo negativo', () => {
    const parsed = interpretReceiptText(
      'Comprovante de transferência\nValor nominal: R$ 50,00\nValor pago: R$ 40,00\nData do pagamento: 2026-10-29\nIdentificador da transação: TX-SINTETICA-123',
      'PDF_TEXT',
    );
    expect(parsed.fields.documentType?.value).toBe('TRANSFERENCIA');
    expect(parsed.fields.transactionId?.value).toBe('TX-SINTETICA-123');
    const comparison = reconcileReceipt({
      originalAmount: '50',
      previousPaid: '0',
      balance: '50',
      dueDate: '2026-10-30',
      fields: parsed.fields,
      today: '2026-10-31',
    });
    expect(comparison.outcome).toBe('PARTIAL');
    expect(comparison.flags).toContain('INSUFFICIENT');
    expect(comparison.balanceAfter).toBe('10.00');
  });

  it('preserva centavos no pagamento parcial e na quitação', () => {
    const fields = interpretReceiptText(pix, 'PDF_TEXT').fields;
    const partial = reconcileReceipt({
      originalAmount: '100.00',
      previousPaid: '0',
      balance: '100.00',
      dueDate: '2026-10-30',
      fields,
      today: '2026-10-31',
    });
    expect(partial.outcome).toBe('PARTIAL');
    expect(partial.balanceAfter).toBe('66.66');
    const full = reconcileReceipt({
      originalAmount: '100.00',
      previousPaid: '33.34',
      balance: '66.66',
      dueDate: '2026-10-30',
      fields: { ...fields, paidAmount: { value: '66.66', source: 'OCR', confidence: 0.6 } },
      today: '2026-10-31',
    });
    expect(full.outcome).toBe('FULL');
    expect(full.balanceAfter).toBe('0.00');
  });

  it('distingue excedente, divergência de cobrança e documento inconclusivo', () => {
    const fields = interpretReceiptText(pix, 'OCR').fields;
    const excess = reconcileReceipt({
      originalAmount: '33.33',
      previousPaid: '0',
      balance: '33.33',
      dueDate: '2026-10-30',
      fields,
      today: '2026-10-31',
    });
    expect(excess.outcome).toBe('EXCESS');
    expect(excess.balanceAfter).toBeNull();
    const empty = interpretReceiptText('Documento sem valor', 'OCR');
    expect(empty.fields.paidAmount).toBeUndefined();
    expect(
      reconcileReceipt({
        originalAmount: '10',
        previousPaid: '0',
        balance: '10',
        dueDate: '2026-10-30',
        fields: empty.fields,
      }).outcome,
    ).toBe('INCONCLUSIVE');
  });

  it('rejeita datas impossíveis e sinaliza pagamento no futuro', () => {
    expect(brazilianDate('31/02/2026')).toBeUndefined();
    expect(brazilianDate('00/10/2026')).toBeUndefined();
    expect(brazilianDate('29/02/2024')).toBe('2024-02-29');
    expect(brazilianDate('29-10-2026')).toBe('2026-10-29');
    expect(brazilianDate('2026-10-29')).toBe('2026-10-29');
    const invalid = interpretReceiptText(
      'Valor pago: R$ 10,00\nData do pagamento: 31/02/2026',
      'PDF_TEXT',
    );
    expect(invalid.warnings).toContain('Data inválida no campo paidDate.');
    const future = interpretReceiptText(
      'Valor pago: R$ 10,00\nData do pagamento: 31/12/2026',
      'PDF_TEXT',
    );
    expect(
      reconcileReceipt({
        originalAmount: '10',
        previousPaid: '0',
        balance: '10',
        dueDate: '2026-10-30',
        fields: future.fields,
        today: '2026-10-31',
      }).warnings,
    ).toContain('A data de pagamento está no futuro.');
  });

  it('converte moeda brasileira sem arredondamento de ponto flutuante', () => {
    expect(decimalFromBrazilian('1.234,56')?.toFixed(2)).toBe('1234.56');
    expect(decimalFromBrazilian('0,01')?.toFixed(2)).toBe('0.01');
    expect(decimalFromBrazilian('1,2')).toBeUndefined();
  });
});
