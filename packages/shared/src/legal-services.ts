export type LegalServiceArea = 'GENERAL' | 'CRIMINAL';

export interface DefaultLegalService {
  readonly name: string;
  readonly area: LegalServiceArea;
}

export const DEFAULT_LEGAL_SERVICES: readonly DefaultLegalService[] = [
  { name: 'Consultoria jurídica', area: 'GENERAL' },
  { name: 'Análise de documentos', area: 'GENERAL' },
  { name: 'Elaboração de contrato', area: 'GENERAL' },
  { name: 'Acompanhamento processual', area: 'GENERAL' },
  { name: 'Acompanhamento em delegacia', area: 'CRIMINAL' },
  { name: 'Defesa em inquérito policial', area: 'CRIMINAL' },
  { name: 'Audiência de custódia', area: 'CRIMINAL' },
  { name: 'Pedido de liberdade provisória', area: 'CRIMINAL' },
  { name: 'Habeas corpus', area: 'CRIMINAL' },
  { name: 'Defesa em ação penal', area: 'CRIMINAL' },
  { name: 'Queixa-crime', area: 'CRIMINAL' },
  { name: 'Assistência à acusação', area: 'CRIMINAL' },
  { name: 'Execução penal', area: 'CRIMINAL' },
  { name: 'Revisão criminal', area: 'CRIMINAL' },
  { name: 'Diligência criminal', area: 'CRIMINAL' },
];

export function normalizeLegalServiceName(name: string) {
  return name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR');
}
