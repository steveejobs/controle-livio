import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@livio/db';
import { normalizeAndValidateTaxId } from '../common/tax-id';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  AlignmentType,
  Document as WordDocument,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import {
  DEFAULT_DOCUMENT_TEMPLATES,
  DOCUMENT_TEMPLATE_LABELS,
  validateDocumentTemplate,
  type DocumentTemplateCategory,
} from './document-templates';

export type LegalClient = {
  type: 'PERSON' | 'COMPANY';
  displayName: string;
  legalName: string | null;
  taxIdNormalized: string | null;
  address: unknown;
  customFields: unknown;
};

export type OfficeDocumentSettings = {
  attorneyName: string;
  professionalRegistration: string;
  officeAddress: string;
  jurisdiction: string;
  paymentInstructions?: string;
};

export type ContractDocumentData = {
  number: string;
  title: string;
  feeModel: string;
  fixedAmount: string | null;
  successRate: string | null;
  currency: string;
  serviceName: string | null;
  terms: unknown;
  matter: {
    reference: string;
    title: string;
    courtNumberNormalized: string | null;
    area: string | null;
  } | null;
  endsAt: Date | null;
  receivables: Array<{
    reference: string;
    originalAmount: string;
    currency: string;
    installments: Array<{ sequence: number; amount: string; dueDate: Date }>;
  }>;
};

export type GeneratedDocumentCategory = DocumentTemplateCategory;

type Address = {
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

type LegalIdentity = {
  nationality?: string;
  civilStatus?: string;
  occupation?: string;
  identityDocument?: string;
  birthDate?: string;
};

type LegalRepresentative = { name?: string; taxId?: string };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function customGroup<T extends object>(value: unknown, key: string): T {
  return record(record(value)[key]) as T;
}

function formatTaxId(value: string | null | undefined, type: 'PERSON' | 'COMPANY'): string {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (type === 'PERSON' && digits.length === 11)
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (type === 'COMPANY' && digits.length === 14)
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return digits || '';
}

function validatedTaxId(value: string | null | undefined, type: 'PERSON' | 'COMPANY'): string {
  try {
    const normalized = normalizeAndValidateTaxId(value ?? undefined);
    if (!normalized || normalized.length !== (type === 'PERSON' ? 11 : 14)) throw new Error();
    return formatTaxId(normalized, type);
  } catch {
    throw new BadRequestException(
      `Informe um ${type === 'PERSON' ? 'CPF' : 'CNPJ'} válido no cadastro.`,
    );
  }
}

function addressText(value: unknown): string {
  const address = record(value) as Address;
  const street = clean(address.street);
  const number = clean(address.number);
  const complement = clean(address.complement);
  const district = clean(address.district);
  const city = clean(address.city);
  const state = clean(address.state)?.toUpperCase();
  const postalCode = clean(address.postalCode);
  if (!street || !city || !state) return '';
  return [
    `${street}${number ? `, nº ${number}` : ''}`,
    complement,
    district ? `bairro ${district}` : undefined,
    `${city}/${state}`,
    postalCode ? `CEP ${postalCode}` : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(', ');
}

function qualification(client: LegalClient): string {
  const address = addressText(client.address);
  const custom = record(client.customFields);
  const identity = customGroup<LegalIdentity>(custom, 'legalIdentity');
  const representative = customGroup<LegalRepresentative>(custom, 'legalRepresentative');
  const clientTaxId = validatedTaxId(client.taxIdNormalized, client.type);

  if (!address)
    throw new BadRequestException(
      'Complete logradouro, cidade e estado (UF) no endereço do cliente antes de gerar os documentos.',
    );

  if (client.type === 'COMPANY') {
    const name = clean(representative.name);
    const taxId = clean(representative.taxId);
    if (!client.legalName)
      throw new BadRequestException('Informe a razão social da empresa para gerar os documentos.');
    if (!name || !taxId)
      throw new BadRequestException(
        'Informe o nome e o CPF do representante legal no cadastro da empresa.',
      );
    const formattedTaxId = validatedTaxId(taxId, 'PERSON');
    return `${client.legalName}, pessoa jurídica de direito privado, inscrita no CNPJ nº ${clientTaxId}, com sede em ${address}, neste ato representada por ${name}, CPF nº ${formattedTaxId}`;
  }

  const optionalDetails = [
    clean(identity.nationality),
    clean(identity.civilStatus),
    clean(identity.occupation),
  ].filter((part): part is string => Boolean(part));
  const identityDocument = clean(identity.identityDocument);
  const birthDate = clean(identity.birthDate);
  return [
    client.displayName,
    ...optionalDetails,
    ...(birthDate ? [`nascido(a) em ${dateText(birthDate)}`] : []),
    ...(identityDocument ? [`RG nº ${identityDocument}`] : []),
    `CPF nº ${clientTaxId}`,
    `residente e domiciliado(a) em ${address}`,
  ].join(', ');
}

function decimalParts(value: string): { whole: bigint; fraction: string } {
  const match = /^(\d{1,15})(?:\.(\d{1,4}))?$/.exec(value);
  if (!match) throw new BadRequestException('O valor dos honorários está inválido.');
  return { whole: BigInt(match[1]!), fraction: (match[2] ?? '').padEnd(2, '0') };
}

function groupedInteger(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const units = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const teens = [
  'dez',
  'onze',
  'doze',
  'treze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
];
const tens = [
  '',
  '',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
];
const hundreds = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

function tripletWords(value: number): string {
  if (value === 0) return '';
  if (value === 100) return 'cem';
  const parts: string[] = [];
  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  if (hundred) parts.push(hundreds[hundred]!);
  if (rest >= 10 && rest < 20) parts.push(teens[rest - 10]!);
  else {
    const ten = Math.floor(rest / 10);
    const unit = rest % 10;
    if (ten) parts.push(tens[ten]!);
    if (unit) parts.push(units[unit]!);
  }
  return parts.join(' e ');
}

function integerWords(value: bigint): string {
  if (value === 0n) return 'zero';
  const scales: Record<number, { singular: string; plural?: string }> = {
    0: { singular: '' },
    1: { singular: 'mil' },
    2: { singular: 'milhão', plural: 'milhões' },
    3: { singular: 'bilhão', plural: 'bilhões' },
    4: { singular: 'trilhão', plural: 'trilhões' },
    5: { singular: 'quadrilhão', plural: 'quadrilhões' },
  };
  let rest = value;
  let scale = 0;
  const groups: Array<{ value: number; scale: number }> = [];
  while (rest > 0n) {
    groups.push({ value: Number(rest % 1000n), scale });
    rest /= 1000n;
    scale += 1;
  }
  const words = groups
    .filter(({ value: amount }) => amount > 0)
    .map(({ value: amount, scale: position }) => {
      const scaleLabel = scales[position];
      if (!scaleLabel) throw new BadRequestException('O valor dos honorários é alto demais.');
      if (position === 1)
        return amount === 1
          ? scaleLabel.singular
          : `${tripletWords(amount)} ${scaleLabel.singular}`;
      if (position > 1)
        return `${tripletWords(amount)} ${amount === 1 ? scaleLabel.singular : scaleLabel.plural}`;
      return tripletWords(amount);
    });
  return words.reverse().join(' e ');
}

export function formatLegalMoney(value: string, currency: string): string {
  const { whole, fraction } = decimalParts(value);
  let decimals = fraction;
  while (decimals.length > 2 && decimals.endsWith('0')) decimals = decimals.slice(0, -1);
  const currencyName = currency.toUpperCase() === 'BRL' ? 'R$' : currency.toUpperCase();
  return `${currencyName} ${groupedInteger(whole)},${decimals}`;
}

export function legalMoneyInWords(value: string, currency: string): string {
  const { whole, fraction } = decimalParts(value);
  if (currency.toUpperCase() !== 'BRL' || fraction.slice(2).replace(/0/g, '')) return '';
  const cents = Number(fraction.slice(0, 2));
  const parts = [`${integerWords(whole)} ${whole === 1n ? 'real' : 'reais'}`];
  if (cents) parts.push(`${integerWords(BigInt(cents))} ${cents === 1 ? 'centavo' : 'centavos'}`);
  return parts.join(' e ');
}

function dateText(value: Date | string): string {
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw;
}

function percentText(value: string): string {
  const match = /^(\d)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return '';
  const decimal = `${match[1]}${(match[2] ?? '').padEnd(6, '0')}`;
  const percentage = BigInt(decimal) * 100n;
  const whole = percentage / 1_000_000n;
  const fraction = (percentage % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `,${fraction}` : ''}%`;
}

function termServices(contract: ContractDocumentData): string[] {
  const services = record(contract.terms).services;
  const configured = Array.isArray(services)
    ? services.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
  return configured.length
    ? configured
    : contract.serviceName
      ? [contract.serviceName]
      : [contract.title];
}

export function renderDocumentTemplate(
  category: GeneratedDocumentCategory,
  template: string,
  values: Record<string, string>,
): string {
  validateDocumentTemplate(category, template);
  return template.replace(/\{\{[^{}]+\}\}/g, (token) => values[token] ?? '');
}

@Injectable()
export class DocumentGeneratorService {
  private readonly logo = readFileSync(join(__dirname, 'assets', 'livio-logo.jpeg'));

  async generate(
    category: GeneratedDocumentCategory,
    client: LegalClient,
    options: {
      contract?: ContractDocumentData;
      office?: OfficeDocumentSettings;
      template?: string;
      issuedAt?: Date;
    } = {},
  ): Promise<Buffer> {
    const issueDate = options.issuedAt
      ? dateText(options.issuedAt)
      : new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).format(new Date());
    const values = this.variables(category, client, options.contract, options.office, issueDate);
    const template = options.template ?? DEFAULT_DOCUMENT_TEMPLATES[category];
    const content = renderDocumentTemplate(category, template, values);
    const lines = content.split(/\r?\n/);
    const firstContentLine = lines.findIndex((line) => line.trim());
    const paragraphs = lines.flatMap((line, index) => {
      const text = line.trim();
      if (!text) return [];
      if (index === firstContentLine) return [this.heading(text)];
      if (/^[A-ZÀ-ÖØ-Þ0-9\s.,;:ºª—–()/'-]+$/.test(text) && /[A-ZÀ-ÖØ-Þ]/.test(text))
        return [this.sectionHeading(text)];
      const bullet = text.startsWith('•');
      return [this.body(bullet ? text.slice(1).trim() : text, bullet)];
    });
    const document = new WordDocument({
      creator: 'Lívio',
      title: DOCUMENT_TEMPLATE_LABELS[category],
      description: 'Documento preenchido com os dados atuais do cliente e do cadastro.',
      styles: {
        default: {
          document: {
            run: { font: 'Courier New', size: 22, color: '202124' },
            paragraph: { spacing: { line: 360, after: 180 } },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 },
              margin: { top: 900, right: 1000, bottom: 900, left: 1000 },
            },
          },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 320 },
              children: [
                new ImageRun({
                  data: this.logo,
                  transformation: { width: 186, height: 49 },
                  type: 'jpg',
                }),
              ],
            }),
            ...paragraphs,
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 500, after: 0 },
              children: [
                new TextRun({
                  text: `Emitido em ${issueDate} · Sistema Lívio`,
                  font: 'Courier New',
                  size: 16,
                  color: '666666',
                }),
              ],
            }),
          ],
        },
      ],
    });
    return Buffer.from(await Packer.toBuffer(document));
  }

  async generatePdf(
    category: GeneratedDocumentCategory,
    client: LegalClient,
    options: {
      contract?: ContractDocumentData;
      office?: OfficeDocumentSettings;
      template?: string;
      issuedAt?: Date;
    } = {},
  ): Promise<Buffer> {
    const issueDate = options.issuedAt
      ? dateText(options.issuedAt)
      : new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).format(new Date());
    const values = this.variables(category, client, options.contract, options.office, issueDate);
    const template = options.template ?? DEFAULT_DOCUMENT_TEMPLATES[category];
    const content = renderDocumentTemplate(category, template, values);
    const pdf = await PDFDocument.create();
    pdf.setTitle(DOCUMENT_TEMPLATE_LABELS[category]);
    pdf.setAuthor('Lívio');
    pdf.setSubject('Documento preenchido com os dados atuais do cliente e do cadastro.');
    const regular = await pdf.embedFont(StandardFonts.TimesRoman);
    const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
    const logo = await pdf.embedJpg(this.logo);
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 58;
    const contentWidth = pageWidth - margin * 2;
    let page = pdf.addPage([pageWidth, pageHeight]);
    let cursorY = pageHeight - 122;
    let pageNumber = 1;
    const addPage = () => {
      page.drawText(`LÍVIO · ${pageNumber}`, {
        x: margin,
        y: 28,
        size: 8,
        font: regular,
        color: rgb(0.38, 0.42, 0.4),
      });
      pageNumber += 1;
      page = pdf.addPage([pageWidth, pageHeight]);
      page.drawImage(logo, {
        x: (pageWidth - 118) / 2,
        y: pageHeight - 66,
        width: 118,
        height: (logo.height / logo.width) * 118,
      });
      cursorY = pageHeight - 105;
    };
    page.drawImage(logo, {
      x: (pageWidth - 142) / 2,
      y: pageHeight - 80,
      width: 142,
      height: (logo.height / logo.width) * 142,
    });
    page.drawLine({
      start: { x: margin, y: pageHeight - 95 },
      end: { x: pageWidth - margin, y: pageHeight - 95 },
      thickness: 0.7,
      color: rgb(0.78, 0.82, 0.79),
    });

    const drawWrapped = (text: string, font: typeof regular, size: number, lineHeight: number) => {
      const words = text.trim().split(/\s+/).filter(Boolean);
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= contentWidth || !line) {
          line = candidate;
          continue;
        }
        if (cursorY < 64) addPage();
        page.drawText(line, { x: margin, y: cursorY, size, font, color: rgb(0.14, 0.16, 0.15) });
        cursorY -= lineHeight;
        line = word;
      }
      if (line) {
        if (cursorY < 64) addPage();
        page.drawText(line, { x: margin, y: cursorY, size, font, color: rgb(0.14, 0.16, 0.15) });
        cursorY -= lineHeight;
      }
    };
    const lines = content.split(/\r?\n/);
    const firstContentLine = lines.findIndex((line) => line.trim());
    for (const [index, raw] of lines.entries()) {
      const text = raw.trim();
      if (!text) {
        cursorY -= 7;
        continue;
      }
      const isHeading = index === firstContentLine;
      const isSectionHeading =
        !isHeading && /^[A-ZÀ-ÖØ-Þ0-9\s.,;:ºª—–()/'-]+$/.test(text) && /[A-ZÀ-ÖØ-Þ]/.test(text);
      if (isHeading) {
        cursorY -= 9;
        drawWrapped(text, bold, 16, 21);
        cursorY -= 8;
      } else if (isSectionHeading) {
        cursorY -= 5;
        drawWrapped(text, bold, 11, 16);
        cursorY -= 3;
      } else {
        drawWrapped(text, regular, 10.5, 16);
        cursorY -= 3;
      }
    }
    if (cursorY < 70) addPage();
    page.drawText(`Emitido em ${issueDate} · Sistema Lívio`, {
      x: margin,
      y: 46,
      size: 8,
      font: regular,
      color: rgb(0.38, 0.42, 0.4),
    });
    page.drawText(`LÍVIO · ${pageNumber}`, {
      x: pageWidth - margin - 50,
      y: 28,
      size: 8,
      font: regular,
      color: rgb(0.38, 0.42, 0.4),
    });
    return Buffer.from(await pdf.save());
  }

  private variables(
    category: GeneratedDocumentCategory,
    client: LegalClient,
    contract: ContractDocumentData | undefined,
    office: OfficeDocumentSettings | undefined,
    issueDate: string,
  ): Record<string, string> {
    const clientQualification = qualification(client);
    const address = addressText(client.address);
    const company = client.type === 'COMPANY';
    const clientName = company ? (client.legalName ?? client.displayName) : client.displayName;
    const clientTaxId = validatedTaxId(client.taxIdNormalized, client.type);
    const custom = record(client.customFields);
    const representative = customGroup<LegalRepresentative>(custom, 'legalRepresentative');
    const representativeText =
      company && clean(representative.name) && clean(representative.taxId)
        ? `${clean(representative.name)}, CPF nº ${validatedTaxId(representative.taxId, 'PERSON')}`
        : '';
    let contractNumber = '';
    let object = '';
    let feeText = '';
    let successRate = '';
    let installmentsText = '';
    let termText = '';

    if (category === 'CONTRATO_HONORARIOS') {
      if (!contract) throw new BadRequestException('Selecione o contrato de honorários.');
      if (!office)
        throw new BadRequestException('Configure os dados do escritório antes de emitir.');
      if (contract.fixedAmount && contract.feeModel !== 'HOURLY' && !contract.receivables.length) {
        throw new BadRequestException(
          'Vincule uma cobrança ao contrato para preencher valor, parcelas e vencimentos.',
        );
      }
      if (contract.fixedAmount && contract.feeModel !== 'HOURLY' && contract.receivables.length) {
        const linkedTotal = contract.receivables.reduce(
          (total, receivable) => total.plus(new Prisma.Decimal(receivable.originalAmount)),
          new Prisma.Decimal(0),
        );
        if (!linkedTotal.equals(new Prisma.Decimal(contract.fixedAmount)))
          throw new BadRequestException(
            'O total das cobranças vinculadas precisa corresponder aos honorários fixos do contrato.',
          );
      }
      contractNumber = contract.number;
      const matter = contract.matter
        ? `${contract.matter.title}${contract.matter.courtNumberNormalized ? `, autos nº ${contract.matter.courtNumberNormalized}` : `, referência ${contract.matter.reference}`}`
        : contract.title;
      object = `${termServices(contract).join('; ')} — ${matter}`;

      const feeParts: string[] = [];
      if (contract.fixedAmount) {
        const amount = formatLegalMoney(contract.fixedAmount, contract.currency);
        const words = legalMoneyInWords(contract.fixedAmount, contract.currency);
        feeParts.push(`${amount}${words ? ` (${words})` : ''}`);
        if (contract.feeModel === 'HOURLY') feeParts[0] += ' por hora trabalhada';
      }
      if (contract.successRate) {
        successRate = percentText(contract.successRate);
        feeParts.push(`${successRate} sobre o proveito econômico`);
      }
      if (!feeParts.length)
        throw new BadRequestException('Informe os honorários no cadastro do contrato.');
      feeText = feeParts.join(' e ');

      const schedule = contract.receivables.flatMap((receivable) =>
        receivable.installments.map(
          (installment) =>
            `Parcela ${installment.sequence}: ${formatLegalMoney(installment.amount, receivable.currency)}, vencimento em ${dateText(installment.dueDate)}`,
        ),
      );
      if (contract.fixedAmount && contract.feeModel !== 'HOURLY' && !schedule.length)
        throw new BadRequestException(
          'A cobrança vinculada precisa ter parcelas e vencimentos cadastrados.',
        );
      installmentsText = schedule.length
        ? schedule.map((line) => `• ${line}`).join('\n')
        : contract.feeModel === 'HOURLY'
          ? 'A cobrança será apurada conforme as horas efetivamente prestadas e registradas.'
          : 'Pagamento devido após a obtenção do resultado econômico previsto.';
      termText = contract.endsAt
        ? `até ${dateText(contract.endsAt)}`
        : 'até a conclusão dos serviços contratados';
    }

    if (category === 'PROCURACAO' && !office)
      throw new BadRequestException('Configure os dados do escritório antes de emitir.');
    const attorneyName = office?.attorneyName ?? '';
    const professionalRegistration = office?.professionalRegistration ?? '';
    const attorneyIdentification = office
      ? `${office.attorneyName}, advogado(a), inscrito(a) ${office.professionalRegistration}`
      : '';
    const signatureLines = [
      '________________________________________',
      clientName,
      'CONTRATANTE / OUTORGANTE / DECLARANTE',
      ...(attorneyName
        ? ['', '________________________________________', attorneyName, professionalRegistration]
        : []),
    ].join('\n');
    const witnessLines = [
      'Testemunhas:',
      '1. _______________________________________  CPF: __________________________',
      '2. _______________________________________  CPF: __________________________',
    ].join('\n');

    return {
      '{{cliente.nome}}': clientName,
      '{{cliente.razao_social}}': client.legalName ?? '',
      '{{cliente.cpf_cnpj}}': clientTaxId,
      '{{cliente.endereco}}': address,
      '{{cliente.qualificacao}}': clientQualification,
      '{{cliente.representante}}': representativeText,
      '{{escritorio.advogado}}': attorneyName,
      '{{escritorio.oab}}': professionalRegistration,
      '{{escritorio.identificacao}}': attorneyIdentification,
      '{{escritorio.endereco}}': office?.officeAddress ?? '',
      '{{escritorio.instrucoes_pagamento}}': office?.paymentInstructions ?? '',
      '{{contrato.numero}}': contractNumber,
      '{{contrato.objeto}}': object,
      '{{contrato.honorarios}}': feeText,
      '{{contrato.percentual_exito}}': successRate,
      '{{contrato.parcelas}}': installmentsText,
      '{{contrato.vigencia}}': termText,
      '{{foro}}': office?.jurisdiction ?? '',
      '{{data.emissao}}': issueDate,
      '{{assinaturas}}': signatureLines,
      '{{testemunhas}}': witnessLines,
    };
  }

  private heading(text: string): Paragraph {
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 360 },
      keepNext: true,
      children: [new TextRun({ text, bold: true, font: 'Courier New', size: 28, color: '171717' })],
    });
  }

  private sectionHeading(text: string): Paragraph {
    return new Paragraph({
      spacing: { before: 160, after: 100 },
      keepNext: true,
      children: [new TextRun({ text, bold: true, font: 'Courier New', size: 22 })],
    });
  }

  private body(text: string, bullet = false): Paragraph {
    return new Paragraph({
      alignment: bullet ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
      indent: bullet ? { left: 360 } : { firstLine: 520 },
      spacing: { after: 260, line: 360 },
      children: [new TextRun({ text, font: 'Courier New', size: 22 })],
    });
  }
}
