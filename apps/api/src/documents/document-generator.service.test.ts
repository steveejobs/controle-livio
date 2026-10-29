import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  DocumentGeneratorService,
  formatLegalMoney,
  legalMoneyInWords,
  renderDocumentTemplate,
  type LegalClient,
} from './document-generator.service';
import { DEFAULT_DOCUMENT_TEMPLATES } from './document-templates';

const client: LegalClient = {
  type: 'PERSON',
  displayName: 'Marina Souza',
  legalName: null,
  taxIdNormalized: '52998224725',
  address: { street: 'Rua das Flores', number: '10', city: 'Balsas', state: 'MA' },
  customFields: {},
};

describe('DocumentGeneratorService', () => {
  it('gera um DOCX com marca e dados atuais para hipossuficiência', async () => {
    const service = new DocumentGeneratorService();
    const file = await service.generate('HIPOSSUFICIENCIA', client, {
      issuedAt: new Date('2026-10-21T12:00:00.000Z'),
    });

    expect(file.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(file.byteLength).toBeGreaterThan(5_000);
  });

  it('gera PDF válido para assinatura com dados do cliente', async () => {
    const service = new DocumentGeneratorService();
    const file = await service.generatePdf('HIPOSSUFICIENCIA', client, {
      issuedAt: new Date('2026-10-21T12:00:00.000Z'),
    });
    const pdf = await PDFDocument.load(file);
    expect(file.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    expect(pdf.getTitle()).toBeTruthy();
  });

  it('formata honorários sem converter Decimal em ponto flutuante', () => {
    expect(formatLegalMoney('20000.00', 'BRL')).toBe('R$ 20.000,00');
    expect(formatLegalMoney('1500.1250', 'BRL')).toBe('R$ 1.500,125');
    expect(legalMoneyInWords('20000.00', 'BRL')).toBe('vinte mil reais');
  });

  it('renderiza um modelo editado e bloqueia variáveis desconhecidas ou essenciais removidas', () => {
    const customized = DEFAULT_DOCUMENT_TEMPLATES.HIPOSSUFICIENCIA.replace(
      '{{cliente.qualificacao}}',
      'Este texto foi ajustado. {{cliente.qualificacao}}',
    ).replace(
      'A presente declaração é emitida',
      'Este texto foi ajustado. A presente declaração é emitida',
    );
    const rendered = renderDocumentTemplate('HIPOSSUFICIENCIA', customized, {
      '{{cliente.qualificacao}}': 'Marina Souza, CPF nº 529.982.247-25',
      '{{data.emissao}}': '21/10/2026',
      '{{assinaturas}}': 'Assinatura de Marina Souza',
    });
    expect(rendered).toContain('Este texto foi ajustado.');
    expect(rendered).toContain('21/10/2026');
    expect(() =>
      renderDocumentTemplate(
        'HIPOSSUFICIENCIA',
        `${customized}\n{{cliente.campo_inexistente}}`,
        {},
      ),
    ).toThrow('Variável não reconhecida');
    expect(() =>
      renderDocumentTemplate('HIPOSSUFICIENCIA', `${customized}\n{{cliente.nome}`, {}),
    ).toThrow('variável incompleta');
    expect(() =>
      renderDocumentTemplate(
        'HIPOSSUFICIENCIA',
        customized.replace('{{cliente.qualificacao}}', 'declarante'),
        {},
      ),
    ).toThrow('Mantenha estas informações automáticas');
  });

  it('não gera documento de pessoa física sem CPF ou endereço', async () => {
    const service = new DocumentGeneratorService();
    await expect(
      service.generate('HIPOSSUFICIENCIA', { ...client, taxIdNormalized: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.generate(
        'PROCURACAO',
        { ...client, address: null },
        {
          office: {
            attorneyName: 'Advogada Teste',
            professionalRegistration: 'OAB/MA 12345',
            officeAddress: 'Rua Um, 2, Centro',
            jurisdiction: 'Balsas/MA',
          },
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('não gera documento de empresa sem representante legal identificado', async () => {
    const service = new DocumentGeneratorService();
    await expect(
      service.generate('HIPOSSUFICIENCIA', {
        ...client,
        type: 'COMPANY',
        displayName: 'Empresa Teste',
        legalName: 'Empresa Teste Ltda.',
        taxIdNormalized: '11222333000181',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
