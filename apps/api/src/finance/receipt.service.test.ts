import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptService } from './receipt.service';

const actor = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  userId: 'a0000000-0000-4000-8000-000000000001',
  sessionId: 'synthetic-session',
  permissions: [
    'receipts:create',
    'receipts:view',
    'receipts:approve',
    'receivables:view',
    'payments:create',
  ],
};
const file = {
  mimetype: 'application/pdf',
  size: 50,
  buffer: Buffer.from('%PDF-test'),
  originalname: 'sintetico.pdf',
} as Express.Multer.File;
const target = {
  clientId: '11000000-0000-4000-8000-000000000001',
  originalAmount: '100.00',
  previousPaid: '0.00',
  balance: '100.00',
  dueDate: '2026-10-30',
  status: 'OPEN',
};

describe('serviço de comprovantes', () => {
  const prisma = {
    paymentReceipt: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
    document: { updateMany: vi.fn() },
    documentVersion: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  const finance = { installmentReceiptBalance: vi.fn(), createPayment: vi.fn() };
  const documents = { validateFile: vi.fn(), create: vi.fn() };
  const scanner = { assertClean: vi.fn() };
  const extraction = { extract: vi.fn() };
  const storage = { remove: vi.fn() };
  const audit = { record: vi.fn() };
  const service = new ReceiptService(
    prisma as never,
    finance as never,
    documents as never,
    scanner as never,
    extraction as never,
    storage as never,
    audit as never,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    finance.installmentReceiptBalance.mockResolvedValue(target);
    prisma.paymentReceipt.findUnique.mockResolvedValue(null);
    prisma.organization.findUnique.mockResolvedValue({ timezone: 'America/Sao_Paulo' });
    scanner.assertClean.mockResolvedValue(undefined);
    extraction.extract.mockResolvedValue({
      fields: {
        paidAmount: { value: '25.00', source: 'PDF_TEXT', confidence: 0.9 },
        paidDate: { value: '2026-10-30', source: 'PDF_TEXT', confidence: 0.9 },
      },
      warnings: [],
      method: 'PDF_TEXT',
    });
    documents.create.mockResolvedValue({ id: 'document-1' });
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({
          paymentReceipt: {
            create: vi.fn().mockResolvedValue({ id: 'receipt-1', status: 'PENDING_REVIEW' }),
          },
        }),
    );
  });

  it('bloqueia duplicidade antes de varredura, OCR e Storage', async () => {
    prisma.paymentReceipt.findUnique.mockResolvedValue({ id: 'receipt-already-sent' });
    await expect(
      service.submit(actor as never, { installmentId: 'installment-1' }, file),
    ).rejects.toThrow('já foi enviado');
    expect(scanner.assertClean).not.toHaveBeenCalled();
    expect(documents.create).not.toHaveBeenCalled();
  });

  it('não armazena nem processa OCR quando o scanner rejeita o arquivo', async () => {
    scanner.assertClean.mockRejectedValue(new Error('infectado'));
    await expect(
      service.submit(actor as never, { installmentId: 'installment-1' }, file),
    ).rejects.toThrow('infectado');
    expect(extraction.extract).not.toHaveBeenCalled();
    expect(documents.create).not.toHaveBeenCalled();
  });

  it('armazena apenas após a varredura e mantém envio do cliente pendente', async () => {
    const order: string[] = [];
    scanner.assertClean.mockImplementation(async () => {
      order.push('scan');
    });
    extraction.extract.mockImplementation(async () => {
      order.push('extract');
      return {
        fields: { paidAmount: { value: '25.00', source: 'OCR', confidence: 0.6 } },
        warnings: [],
        method: 'OCR',
      };
    });
    documents.create.mockImplementation(async () => {
      order.push('store');
      return { id: 'document-1' };
    });
    const result = await service.submit(
      { ...actor, clientId: target.clientId } as never,
      { installmentId: 'installment-1' },
      file,
    );
    expect(order).toEqual(['scan', 'extract', 'store']);
    expect(result.status).toBe('PENDING_REVIEW');
    expect(finance.createPayment).not.toHaveBeenCalled();
  });

  it('não permite que o cliente confirme o próprio comprovante', async () => {
    await expect(
      service.confirm({ ...actor, clientId: target.clientId } as never, 'receipt-1', {
        amount: '25.00',
        paidAt: '2026-10-30T12:00:00-03:00',
        method: 'PIX',
        reference: 'TESTE',
      }),
    ).rejects.toThrow('cliente não pode confirmar');
    expect(finance.createPayment).not.toHaveBeenCalled();
  });

  it('usa a transação financeira existente para confirmação com idempotência por recibo', async () => {
    prisma.paymentReceipt.findFirst.mockResolvedValue({
      id: 'receipt-1',
      status: 'PENDING_REVIEW',
      installmentId: 'installment-1',
      expenseId: null,
      clientId: target.clientId,
      extractedFields: {
        paidAmount: { value: '25.00' },
        paidDate: { value: '2026-10-30' },
        institution: { value: 'Banco Sintético' },
        transactionId: { value: 'TX-TESTE-123456' },
        documentType: { value: 'TRANSFERENCIA' },
      },
      reconciliation: { difference: '0.00', warnings: [] },
    });
    const result = await service.confirm(actor as never, 'receipt-1', {
      amount: '25.00',
      paidAt: '2026-10-30T12:00:00-03:00',
      method: 'PIX',
      reference: 'PIX-TESTE',
    });
    expect(finance.createPayment).toHaveBeenCalledWith(
      actor,
      'receipt:receipt-1',
      expect.objectContaining({
        amount: '25.0000',
        externalId: expect.stringMatching(/^livio-receipt:v1:TRANSFER_TRANSACTION:[a-f0-9]{64}$/),
        allocations: [{ installmentId: 'installment-1', amount: '25.0000' }],
      }),
      { receiptId: 'receipt-1', correctionReason: undefined },
    );
    expect(result).toBeUndefined();
  });

  it('permite confirmar um valor parcial sem tratá-lo como correção do OCR', async () => {
    prisma.paymentReceipt.findFirst.mockResolvedValue({
      id: 'receipt-1',
      status: 'PENDING_REVIEW',
      installmentId: 'installment-1',
      expenseId: null,
      clientId: target.clientId,
      extractedFields: {
        paidAmount: { value: '25.00' },
        paidDate: { value: '2026-10-30' },
      },
      reconciliation: {
        difference: '-75.00',
        dueAmountDifference: '0.00',
        ledgerDifference: '0.00',
        warnings: ['O valor pago difere da cobrança indicada no documento.'],
      },
    });
    await expect(
      service.confirm(actor as never, 'receipt-1', {
        amount: '25.00',
        paidAt: '2026-10-30T12:00:00-03:00',
        method: 'PIX',
        reference: 'PARCIAL-25',
      }),
    ).resolves.toBeUndefined();
    expect(finance.createPayment).toHaveBeenCalledOnce();
  });

  it('exige motivo quando valores do boleto divergem do nominal calculado ou do saldo', async () => {
    prisma.paymentReceipt.findFirst.mockResolvedValue({
      id: 'receipt-1',
      status: 'PENDING_REVIEW',
      installmentId: 'installment-1',
      expenseId: null,
      clientId: target.clientId,
      extractedFields: {
        paidAmount: { value: '25.00' },
        paidDate: { value: '2026-10-30' },
      },
      reconciliation: {
        difference: '0.00',
        dueAmountDifference: '-1.00',
        ledgerDifference: '0.00',
        warnings: ['O valor devido difere do valor calculado.'],
      },
    });
    await expect(
      service.confirm(actor as never, 'receipt-1', {
        amount: '25.00',
        paidAt: '2026-10-30T12:00:00-03:00',
        method: 'PIX',
        reference: 'BOLETO-DIVERGENTE',
      }),
    ).rejects.toThrow('Informe o motivo da correção');
    expect(finance.createPayment).not.toHaveBeenCalled();
  });

  it('bloqueia confirmação acima do saldo sem lançar pagamento', async () => {
    prisma.paymentReceipt.findFirst.mockResolvedValue({
      id: 'receipt-1',
      status: 'PENDING_REVIEW',
      installmentId: 'installment-1',
      expenseId: null,
      clientId: target.clientId,
      extractedFields: {
        paidAmount: { value: '25.00' },
        paidDate: { value: '2026-10-30' },
      },
      reconciliation: { difference: '0.00', warnings: [] },
    });
    finance.installmentReceiptBalance.mockResolvedValue({ ...target, balance: '10.00' });
    await expect(
      service.confirm(actor as never, 'receipt-1', {
        amount: '25.00',
        paidAt: '2026-10-30T12:00:00-03:00',
        method: 'PIX',
        reference: 'PIX-EXCESSO',
      }),
    ).rejects.toThrow('excede o saldo');
    expect(finance.createPayment).not.toHaveBeenCalled();
  });
});
