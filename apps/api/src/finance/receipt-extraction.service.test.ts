import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { ReceiptExtractionService } from './receipt-extraction.service';

describe('leitura local de comprovantes sintéticos', () => {
  it('extrai texto nativo de PDF sem enviar o arquivo a terceiros', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([500, 300]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('Valor pago: R$ 25,00', { x: 30, y: 220, size: 18, font });
    page.drawText('Data do pagamento: 30/10/2026', { x: 30, y: 185, size: 18, font });
    const result = await new ReceiptExtractionService().extract(
      Buffer.from(await pdf.save()),
      'application/pdf',
    );
    expect(result.method).toBe('PDF_TEXT');
    expect(result.fields.paidAmount?.value).toBe('25.00');
    expect(result.fields.paidDate?.value).toBe('2026-10-30');
  });

  it('executa OCR local sobre imagem PNG legível', async () => {
    const canvas = createCanvas(1500, 300);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 1500, 300);
    context.fillStyle = '#000';
    context.font = '48px Arial';
    context.fillText('Valor pago: R$ 25,00', 35, 105);
    context.fillText('Data do pagamento: 30/10/2026', 35, 205);
    const result = await new ReceiptExtractionService().extract(
      canvas.toBuffer('image/png'),
      'image/png',
    );
    expect(result.method).toBe('OCR');
    expect(result.fields.paidAmount?.value).toBe('25.00');
    expect(result.fields.paidDate?.value).toBe('2026-10-30');
  }, 30_000);

  it('executa OCR local sobre JPEG legível', async () => {
    const canvas = createCanvas(1500, 300);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 1500, 300);
    context.fillStyle = '#000';
    context.font = '48px Arial';
    context.fillText('Valor pago: R$ 12,50', 35, 105);
    context.fillText('Data do pagamento: 30/10/2026', 35, 205);
    const result = await new ReceiptExtractionService().extract(
      canvas.toBuffer('image/jpeg'),
      'image/jpeg',
    );
    expect(result.fields.paidAmount?.value).toBe('12.50');
    expect(result.fields.paidDate?.value).toBe('2026-10-30');
  }, 30_000);

  it('usa OCR nas páginas de PDF digitalizado sem texto selecionável', async () => {
    const canvas = createCanvas(1500, 300);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 1500, 300);
    context.fillStyle = '#000';
    context.font = '48px Arial';
    context.fillText('Valor pago: R$ 25,00', 35, 105);
    context.fillText('Data do pagamento: 30/10/2026', 35, 205);
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([750, 150]);
    const image = await pdf.embedPng(canvas.toBuffer('image/png'));
    page.drawImage(image, { x: 0, y: 0, width: 750, height: 150 });
    const result = await new ReceiptExtractionService().extract(
      Buffer.from(await pdf.save()),
      'application/pdf',
    );
    expect(result.method).toBe('OCR');
    expect(result.fields.paidAmount?.value).toBe('25.00');
    expect(result.fields.paidDate?.value).toBe('2026-10-30');
  }, 30_000);
});
