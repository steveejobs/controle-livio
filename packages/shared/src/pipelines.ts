export type PipelineKind = 'COMMERCIAL' | 'LEGAL' | 'COLLECTION';

export interface PipelineStageTemplate {
  readonly name: string;
  readonly position: number;
  readonly color: string;
  readonly terminal: boolean;
}

export interface PipelineTemplate {
  readonly kind: PipelineKind;
  readonly name: string;
  readonly stages: readonly PipelineStageTemplate[];
}

export const pipelineTemplates: readonly PipelineTemplate[] = [
  {
    kind: 'COMMERCIAL',
    name: 'Comercial',
    stages: [
      { name: 'Novo contato', position: 10, color: '#77B8A3', terminal: false },
      { name: 'Qualificação', position: 20, color: '#D4A44C', terminal: false },
      { name: 'Proposta', position: 30, color: '#B88746', terminal: false },
      { name: 'Contratado', position: 40, color: '#327A69', terminal: true },
      { name: 'Perdido', position: 50, color: '#8C9490', terminal: true },
    ],
  },
  {
    kind: 'LEGAL',
    name: 'Jurídico',
    stages: [
      { name: 'Triagem', position: 10, color: '#77B8A3', terminal: false },
      { name: 'Em preparação', position: 20, color: '#D4A44C', terminal: false },
      { name: 'Em andamento', position: 30, color: '#B88746', terminal: false },
      { name: 'Aguardando decisão', position: 40, color: '#5B7FA6', terminal: false },
      { name: 'Encerrado', position: 50, color: '#327A69', terminal: true },
    ],
  },
  {
    kind: 'COLLECTION',
    name: 'Cobrança',
    stages: [
      { name: 'A vencer', position: 10, color: '#77B8A3', terminal: false },
      { name: 'Em atraso', position: 20, color: '#D97757', terminal: false },
      { name: 'Em negociação', position: 30, color: '#D4A44C', terminal: false },
      { name: 'Recebido', position: 40, color: '#327A69', terminal: true },
      { name: 'Inadimplente', position: 50, color: '#8E4351', terminal: true },
    ],
  },
];
