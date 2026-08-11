export const dashboardNavigation = [
  { label: 'Visão geral', href: '#overview' },
  { label: 'Módulos', href: '#modules' },
  { label: 'Pipelines', href: '#pipelines' },
  { label: 'Segurança', href: '#security' },
] as const;

export const productModules = [
  {
    name: 'Clientes e contatos',
    detail: 'Cadastro multiempresa e histórico centralizado',
    icon: 'CL',
  },
  {
    name: 'Processos jurídicos',
    detail: 'Etapas configuráveis e rastreabilidade integral',
    icon: 'PJ',
  },
  { name: 'Documentos', detail: 'Versões imutáveis, hash e acesso confidencial', icon: 'DC' },
  { name: 'Contas a receber', detail: 'Alocações, ajustes e aprovação financeira', icon: 'RF' },
] as const;
