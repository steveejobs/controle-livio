import { BadRequestException } from '@nestjs/common';

export const DOCUMENT_TEMPLATE_CATEGORIES = [
  'CONTRATO_HONORARIOS',
  'PROCURACAO',
  'HIPOSSUFICIENCIA',
] as const;

export type DocumentTemplateCategory = (typeof DOCUMENT_TEMPLATE_CATEGORIES)[number];

export const DOCUMENT_TEMPLATE_LABELS: Record<DocumentTemplateCategory, string> = {
  CONTRATO_HONORARIOS: 'Contrato de honorários',
  PROCURACAO: 'Procuração',
  HIPOSSUFICIENCIA: 'Declaração de hipossuficiência',
};

export const DEFAULT_DOCUMENT_TEMPLATES: Record<DocumentTemplateCategory, string> = {
  CONTRATO_HONORARIOS: `CONTRATO DE HONORÁRIOS ADVOCATÍCIOS

Contrato nº {{contrato.numero}}

Pelo presente instrumento particular, de um lado {{cliente.qualificacao}}, doravante CONTRATANTE, e de outro {{escritorio.identificacao}}, com endereço profissional em {{escritorio.endereco}}, doravante CONTRATADO, ajustam o presente contrato de prestação de serviços advocatícios.

CLÁUSULA PRIMEIRA — DO OBJETO
O CONTRATADO se compromete a prestar os serviços de {{contrato.objeto}}, no foro de {{foro}}.

CLÁUSULA SEGUNDA — DAS OBRIGAÇÕES
O CONTRATANTE fornecerá ao CONTRATADO os documentos e meios necessários à comprovação do direito pretendido, bem como pagará as despesas judiciais decorrentes da causa.

CLÁUSULA TERCEIRA — DOS HONORÁRIOS
Em remuneração pelos serviços profissionais, o CONTRATANTE pagará ao CONTRATADO {{contrato.honorarios}}. O pagamento será realizado conforme o cronograma abaixo:
{{contrato.parcelas}}

CLÁUSULA QUARTA — DE OUTRAS MEDIDAS
Outras medidas judiciais necessárias, incidentais ou não, diretas ou indiretas, decorrentes da causa contratada, terão novos honorários ajustados entre as partes.

CLÁUSULA QUINTA — DA REVOGAÇÃO E DO ATRASO
Considerar-se-ão vencidos e imediatamente exigíveis os honorários ora contratados no caso de o CONTRATANTE revogar ou cassar o mandato ou exigir o substabelecimento sem reservas, sem que o CONTRATADO tenha dado causa. Em caso de atraso de uma parcela, as demais parcelas poderão ser consideradas vencidas, conforme previsto neste instrumento.

CLÁUSULA SEXTA — DA SUCUMBÊNCIA
Caso haja demanda judicial, os honorários de sucumbência eventualmente fixados pertencerão ao CONTRATADO, sem exclusão dos honorários ora contratados, conforme os artigos 23 da Lei nº 8.906/94 e 35, § 1º, do Código de Ética e Disciplina da Ordem dos Advogados do Brasil.

CLÁUSULA SÉTIMA — DA PRESTAÇÃO DE CONTAS
Quando a causa envolver valores recebíveis pelo CONTRATANTE, o CONTRATADO poderá deduzir os honorários e as despesas dos valores recebidos, mediante prestação de contas.

CLÁUSULA OITAVA — DOS LIMITES DA ATUAÇÃO
A atuação profissional fica restrita ao objeto contratado e ao juízo da causa em primeira instância, {{contrato.vigencia}}. Recursos em tribunais superiores e cartas precatórias serão objeto de ajuste quando não estiverem abrangidos.

CLÁUSULA NONA — DO FORO
As partes elegem o foro de {{foro}} para dirimir controvérsias decorrentes deste contrato, ressalvadas as hipóteses legais.

E por estarem de acordo, assinam este instrumento em duas vias de igual teor. {{foro}}, {{data.emissao}}.

{{assinaturas}}

{{testemunhas}}`,
  PROCURACAO: `PROCURAÇÃO AD JUDICIA ET EXTRA

OUTORGANTE
{{cliente.qualificacao}}

OUTORGADO
Pelo presente instrumento, o(a) OUTORGANTE nomeia e constitui como seu procurador {{escritorio.identificacao}}, com escritório profissional em {{escritorio.endereco}}, onde recebe intimações.

PODERES
Confere poderes para o foro em geral, com cláusula ad judicia, em qualquer juízo, instância ou tribunal, para propor as ações competentes e defendê-lo nas contrárias, acompanhar os atos e interpor recursos legais. Confere também poderes especiais para confessar, desistir, transigir, firmar compromissos ou acordos, receber e dar quitação e substabelecer, com ou sem reserva de iguais poderes.

TRATAMENTO DE DADOS
O(a) OUTORGANTE autoriza o tratamento e o compartilhamento de seus dados pessoais e, quando necessário, dados sensíveis, exclusivamente para fins de representação judicial e extrajudicial e exercício regular da advocacia, observados os princípios de finalidade, adequação, necessidade e segurança previstos na Lei nº 13.709/2018.

{{foro}}, {{data.emissao}}.

{{assinaturas}}`,
  HIPOSSUFICIENCIA: `DECLARAÇÃO DE HIPOSSUFICIÊNCIA ECONÔMICA

{{cliente.qualificacao}}, para fins de pedido de gratuidade da justiça, declara que não dispõe de recursos suficientes para pagar custas, despesas processuais e honorários advocatícios sem prejuízo de seu sustento ou de suas atividades essenciais.

A pessoa declarante está ciente de que a autoridade responsável analisará o pedido e poderá solicitar documentos que comprovem a situação econômica. Esta declaração não substitui documentos adicionais exigidos no caso concreto.

{{data.emissao}}.

{{assinaturas}}`,
};

export type DocumentTemplateVariable = {
  token: string;
  label: string;
  description: string;
  example: string;
  categories: readonly DocumentTemplateCategory[];
};

export const DOCUMENT_TEMPLATE_VARIABLES: readonly DocumentTemplateVariable[] = [
  {
    token: '{{cliente.nome}}',
    label: 'Nome do cliente',
    description: 'Nome da pessoa ou nome empresarial usado no cadastro.',
    example: 'Marina Souza',
    categories: DOCUMENT_TEMPLATE_CATEGORIES,
  },
  {
    token: '{{cliente.razao_social}}',
    label: 'Razão social',
    description: 'Razão social cadastrada para pessoa jurídica.',
    example: 'Empresa Exemplo Ltda.',
    categories: ['CONTRATO_HONORARIOS', 'PROCURACAO', 'HIPOSSUFICIENCIA'] as const,
  },
  {
    token: '{{cliente.cpf_cnpj}}',
    label: 'CPF ou CNPJ',
    description: 'Documento da pessoa ou empresa, com pontuação.',
    example: '123.456.789-00',
    categories: DOCUMENT_TEMPLATE_CATEGORIES,
  },
  {
    token: '{{cliente.endereco}}',
    label: 'Endereço do cliente',
    description: 'Endereço cadastrado do cliente, com cidade e estado.',
    example: 'Rua das Flores, 10, Centro, Balsas/MA',
    categories: DOCUMENT_TEMPLATE_CATEGORIES,
  },
  {
    token: '{{cliente.qualificacao}}',
    label: 'Qualificação completa',
    description: 'Qualificação civil e endereço; inclui representante de empresa.',
    example: 'Marina Souza, brasileira, solteira, CPF nº 123.456.789-00, residente em Balsas/MA',
    categories: DOCUMENT_TEMPLATE_CATEGORIES,
  },
  {
    token: '{{cliente.representante}}',
    label: 'Representante legal',
    description: 'Nome e CPF do representante cadastrado da empresa.',
    example: 'Carlos Souza, CPF nº 123.456.789-00',
    categories: DOCUMENT_TEMPLATE_CATEGORIES,
  },
  {
    token: '{{escritorio.advogado}}',
    label: 'Nome profissional',
    description: 'Nome do profissional configurado pelo Administrador.',
    example: 'Dra. Ana Advogada',
    categories: ['CONTRATO_HONORARIOS', 'PROCURACAO'] as const,
  },
  {
    token: '{{escritorio.oab}}',
    label: 'Inscrição profissional',
    description: 'Número e estado da OAB configurados pelo Administrador.',
    example: 'OAB/MA 12345',
    categories: ['CONTRATO_HONORARIOS', 'PROCURACAO'] as const,
  },
  {
    token: '{{escritorio.identificacao}}',
    label: 'Nome e OAB',
    description: 'Nome profissional seguido da inscrição na OAB.',
    example: 'Dra. Ana Advogada, advogada, inscrita OAB/MA 12345',
    categories: ['CONTRATO_HONORARIOS', 'PROCURACAO'] as const,
  },
  {
    token: '{{escritorio.endereco}}',
    label: 'Endereço profissional',
    description: 'Endereço do escritório configurado pelo Administrador.',
    example: 'Rua Central, 10, Balsas/MA',
    categories: ['CONTRATO_HONORARIOS', 'PROCURACAO'] as const,
  },
  {
    token: '{{escritorio.instrucoes_pagamento}}',
    label: 'Instruções de pagamento',
    description: 'Texto opcional definido nos dados do escritório.',
    example: 'Pagamento por transferência para os dados informados pelo escritório.',
    categories: ['CONTRATO_HONORARIOS'] as const,
  },
  {
    token: '{{contrato.numero}}',
    label: 'Número do contrato',
    description: 'Número do contrato de honorários selecionado.',
    example: 'H-2026-001',
    categories: ['CONTRATO_HONORARIOS'] as const,
  },
  {
    token: '{{contrato.objeto}}',
    label: 'Serviços e objeto',
    description: 'Serviços marcados e processo relacionado ao contrato.',
    example: 'Acompanhamento em delegacia, relacionado ao inquérito policial',
    categories: ['CONTRATO_HONORARIOS'] as const,
  },
  {
    token: '{{contrato.honorarios}}',
    label: 'Honorários',
    description: 'Valor fixo, valor por hora e/ou percentual de êxito.',
    example: 'R$ 2.000,00 (dois mil reais) e 15% sobre o proveito econômico',
    categories: ['CONTRATO_HONORARIOS'] as const,
  },
  {
    token: '{{contrato.percentual_exito}}',
    label: 'Percentual de êxito',
    description: 'Percentual de êxito registrado no contrato.',
    example: '15%',
    categories: ['CONTRATO_HONORARIOS'] as const,
  },
  {
    token: '{{contrato.parcelas}}',
    label: 'Parcelas e vencimentos',
    description: 'Parcelas da cobrança vinculada ao contrato.',
    example: '1ª parcela: R$ 1.000,00, vencimento em 10/11/2026',
    categories: ['CONTRATO_HONORARIOS'] as const,
  },
  {
    token: '{{contrato.vigencia}}',
    label: 'Prazo de vigência',
    description: 'Data final definida ou prazo padrão do contrato.',
    example: 'até 31/12/2026',
    categories: ['CONTRATO_HONORARIOS'] as const,
  },
  {
    token: '{{foro}}',
    label: 'Foro',
    description: 'Foro configurado nos dados do escritório.',
    example: 'Balsas/MA',
    categories: ['CONTRATO_HONORARIOS', 'PROCURACAO'] as const,
  },
  {
    token: '{{data.emissao}}',
    label: 'Data de emissão',
    description: 'Data em que o documento for gerado.',
    example: '21/10/2026',
    categories: DOCUMENT_TEMPLATE_CATEGORIES,
  },
  {
    token: '{{assinaturas}}',
    label: 'Linhas de assinatura',
    description: 'Linhas de assinatura do cliente e, quando aplicável, do profissional.',
    example: 'Linhas para assinatura e identificação das partes',
    categories: DOCUMENT_TEMPLATE_CATEGORIES,
  },
  {
    token: '{{testemunhas}}',
    label: 'Campos de testemunhas',
    description: 'Duas linhas de identificação e CPF para testemunhas.',
    example: 'Testemunhas: duas linhas para nome e CPF',
    categories: ['CONTRATO_HONORARIOS'] as const,
  },
];

export const REQUIRED_DOCUMENT_TEMPLATE_VARIABLES: Record<
  DocumentTemplateCategory,
  readonly string[]
> = {
  CONTRATO_HONORARIOS: [
    '{{cliente.qualificacao}}',
    '{{contrato.numero}}',
    '{{contrato.objeto}}',
    '{{contrato.honorarios}}',
  ],
  PROCURACAO: ['{{cliente.qualificacao}}', '{{escritorio.identificacao}}'],
  HIPOSSUFICIENCIA: ['{{cliente.qualificacao}}', '{{data.emissao}}'],
};

export function validateDocumentTemplate(
  category: DocumentTemplateCategory,
  content: string,
): void {
  const allowed = new Set(
    DOCUMENT_TEMPLATE_VARIABLES.filter((variable) => variable.categories.includes(category)).map(
      ({ token }) => token,
    ),
  );
  const tokens = [...content.matchAll(/\{\{[^{}]+\}\}/g)].map(([token]) => token);
  const plainText = content.replace(/\{\{[^{}]+\}\}/g, '');
  if (plainText.includes('{{') || plainText.includes('}}')) {
    throw new BadRequestException(
      'Há uma variável incompleta no modelo. Insira os dados automáticos pela lista de opções.',
    );
  }
  const unknown = [...new Set(tokens.filter((token) => !allowed.has(token)))];
  if (unknown.length) {
    throw new BadRequestException(
      `Variável não reconhecida neste modelo: ${unknown.join(', ')}. Insira uma variável da lista disponível.`,
    );
  }
  const missing = REQUIRED_DOCUMENT_TEMPLATE_VARIABLES[category].filter(
    (token) => !tokens.includes(token),
  );
  if (missing.length) {
    const labels = missing
      .map(
        (token) => DOCUMENT_TEMPLATE_VARIABLES.find((variable) => variable.token === token)?.label,
      )
      .filter((label): label is string => Boolean(label));
    throw new BadRequestException(
      `Mantenha estas informações automáticas no modelo: ${labels.join(', ')}.`,
    );
  }
}
