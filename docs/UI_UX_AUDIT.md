# Auditoria de intuitividade e ergonomia

Atualizado em 2026-08-09.

## Revisão mobile e instalação em 2026-10-20

- A instalação foi adicionada como PWA pelo navegador: manifest com apresentação `standalone`, nomes,
  cores e ícones 192/512 px e maskable. A web oferece “Instalar aplicativo” no login e no menu
  autenticado; quando o navegador não expõe prompt próprio, abre instruções para iPhone/iPad, Android
  ou computador. O iOS recebe metadados e ícone Apple Touch.
- O menu mobile agora informa estado aberto/fechado, fecha com Escape, envia o foco ao primeiro item,
  devolve o foco ao botão ao fechar e bloqueia rolagem da página de fundo enquanto está aberto. O menu
  continua fechando após escolher uma aba e pelo botão de fundo.
- Verificação em Chrome local autenticado simulado: a 360 px, largura do documento ficou em 360 px;
  menu aberto recebeu foco e bloqueou rolagem; Escape fechou o menu e restaurou o foco; instruções de
  instalação abriram em diálogo nativo acessível. Em 360 e 390 px, formulário e botão de instalação
  ficaram dentro do viewport. O login foi conferido visualmente em 390 px. Testes de navegador
  simularam o fluxo nativo do Chrome e confirmaram instruções específicas de iPhone e Android.
- A rota `/manifest.webmanifest`, os ícones 192/512 px e a raiz web responderam 200 no build local.
  Format check, lint, TypeScript, 46 testes, validação Prisma e build completo passaram.
- A instalação adiciona a aplicação web à tela inicial/launcher e exige conexão para consultar dados;
  esta etapa não inclui pacote nativo APK/EXE nem cache offline. A disponibilidade do prompt automático
  depende do navegador; iPhone/iPad e navegadores sem esse evento recebem passos manuais no próprio
  sistema.

## Diagnóstico atual

O sistema está em um nível **funcional, mas ainda não altamente intuitivo**. A base tem bons sinais:
fluxos nomeados por domínio, busca global com debounce, estados de carregamento/erro/vazio, foco
visível, navegação responsiva e mensagens que não inventam dados quando a API não suporta uma tela.

Os principais atritos observados são:

- a rota inicial ainda concentra autenticação, navegação e busca em `features/app/legal-crm.tsx`,
  enquanto existe um dashboard modular separado que não é o shell ativo; o quadro de processos foi
  movido para `features/matters/matter-board.tsx` e carrega sob demanda;
- há dois vocabulários visuais e uma quantidade relevante de estilos/cor hardcoded em `globals.css`,
  o que aumenta a divergência conforme novos módulos forem adicionados;
- a animação estava limitada aos elementos presentes no primeiro mount e não cobria de forma
  consistente as seções da tela real;
- a busca global ainda não expõe claramente estado de carregamento, ausência de resultados ou uma
  relação completa de teclado entre input e resultados;
- tabelas e Kanban exigem rolagem horizontal em telas estreitas, embora o layout não gere overflow
  do viewport.

## O que foi feito nesta etapa

1. Criado `apps/web/theme/index.css` como entrada única do tema e incluído `interactions.css` no
   carregamento global.
2. Adicionado `apps/web/theme/README.md` com limites e regras de uso dos tokens, motion e interações.
3. O `MotionController` agora usa um único `IntersectionObserver` e observa nós adicionados depois
   da montagem por `MutationObserver`. Seções principais da tela legada recebem reveal incremental.
4. Entrada e saída continuam baseadas somente em `opacity` e `transform`, com stagger discreto e
   fallback para `prefers-reduced-motion`.
5. Hover/foco/press feedback foram centralizados no tema para superfícies, métricas, cartões e
   controles, sem substituir teclado ou touch.
6. A pasta `tools/` foi mantida como domínio de utilitários; `tools/images/optimize.py` já existe,
   preserva originais e possui documentação de instalação/uso.
7. A identidade visível foi consolidada como **Controle Financeiro Lívio** no metadata, login, shell
   autenticado e pacote compartilhado de UI.
8. A navegação foi agrupada em Principal, Operação, Financeiro e Administração, com módulo ativo,
   contexto no cabeçalho e menu mobile com backdrop e estado `aria-expanded`.
9. O login passou a explicar a proposta de valor do produto, separando apresentação e acesso seguro;
   em 360 px a composição reduz para o formulário sem conteúdo decorativo excessivo.
10. Superfícies, tabelas, Kanban, campos e botões receberam hierarquia, espaçamento, estados e
    contraste unificados em `apps/web/theme/product-shell.css`.

## Próximas melhorias prioritárias

1. Dividir o restante de `legal-crm.tsx` em features de autenticação e navegação sem alterar contratos da
   API. A busca global já foi extraída para `features/search`.
2. Fazer o shell modular do dashboard ser a composição principal, ou remover a duplicidade após uma
   decisão de produto registrada.
3. Ampliar a suíte E2E versionada para os demais fluxos autenticados. A busca global já funciona como
   combobox com teclado, estados de carregamento/vazio/erro e anúncio de resultados. Os testes com axe
   cobrem login, nova senha e painel autenticado em 360 px; também cobrem paginação, pagamento e
   recuperação simulada. A simulação ampla no projeto de desenvolvimento foi manual e a suíte
   RLS/Storage ainda depende de Docker ou Podman.
4. Substituir gradualmente literais de cor de `globals.css` por aliases dos tokens, validando contraste
   e estados de foco a cada módulo.

O teste de acessibilidade encontrou e corrigiu um rótulo ARIA inválido no gráfico mensal e uma região
de tabela com rolagem sem foco por teclado. A tabela passou a ser uma região nomeada e focável.

## Critério de intuitividade para as próximas entregas

Uma tarefa comum deve ser compreensível sem treinamento extra: localizar o módulo pelo nome do
domínio, enxergar o estado atual, reconhecer a ação primária, receber feedback após agir e conseguir
desfazer/corrigir por um caminho explícito. Toda tela precisa manter foco visível, estados de erro e
vazio, alvo confortável e funcionamento a 360 px.

## Revisão de coerência dos formulários em 2026-10-21

- A inspeção dos formulários não encontrou título e assunto duplicados com a mesma finalidade. Foram
  revisados cadastro de cliente, ficha do cliente, CRM, tarefas, agenda, documentos, honorários,
  financeiro, equipe, pipelines e filtros de relatórios.
- Os rótulos passaram a indicar a entidade e a tarefa (“O que está sendo cobrado”, “Nome da etapa”,
  “Perfil de acesso”). No CRM, a escolha do pipeline vem antes dos campos do registro e distingue
  processo, oportunidade e cobrança; informações judiciais não aparecem em oportunidades comerciais.
  O estado inicial segue o pipeline, sem solicitar um status redundante na criação.
- O formulário de honorários exibe só os valores aplicáveis ao modelo. Código e nome do serviço para
  relatórios ficam em uma área opcional recolhida; contratos não recebem mais um serviço genérico por
  padrão. Os percentuais são convertidos para a representação decimal da API e exibidos como
  percentual nas listas.
- Os nomes técnicos dos modelos de honorários e dos pipelines foram substituídos por rótulos
  compreensíveis. Ajuda estática de permissões que não correspondia a todos os perfis foi removida.
- Os novos disclosures são nativos, acessíveis por teclado e não substituem as etapas sequenciais do
  cadastro inicial do cliente.

## Cobranças e serviços de contrato em 2026-10-21

- O CRM de cobrança oferece uma opção explícita de objetivo sem valor financeiro. Marcá-la abre o
  campo de descrição; a gravação fica no acompanhamento da cobrança e não altera recebíveis ou saldos.
- A contratação mostra serviços como opções marcáveis, agrupadas entre jurídico criminal e demais
  serviços jurídicos. Novos serviços podem ser salvos na organização e reaproveitados, sem exigir um
  campo de texto livre em cada contrato.
- A lista inclui atividades criminais comuns e mantém o primeiro serviço marcado como classificação
  principal dos relatórios atuais. A seleção e o cadastro novo são cobertos em E2E nos viewports de
  360 e 1440 px.

## Modelos e atividades administrativas em 2026-10-21

- O editor de modelos fica dentro do módulo Documentos e separado da emissão. O usuário escolhe o tipo
  de documento, edita o texto, insere dados por rótulos legíveis agrupados por cliente/escritório/
  contrato e confere uma prévia antes de salvar. As descrições estão visíveis e acessíveis por teclado;
  os marcadores técnicos não precisam ser digitados.
- A validação impede erros previsíveis de variável e conserva os dados essenciais. Mensagens de
  salvamento indicam que alterações valem para futuras emissões, mantendo documentos existentes. O
  editor mostra alterações pendentes e pede confirmação antes de descartá-las ao trocar de modelo.
- A página **Atividades do sistema** substitui os logs técnicos por descrições de ação, pessoa,
  horário e campos afetados. Filtros por tipo, usuário, texto e data deixam o histórico direto de
  consultar; valores antigos e novos não aparecem na interface.
- A cobertura com Playwright/axe verifica os fluxos em 360 e 1440 px, inclusive editor, prévia,
  salvamento, restauração, leitura das atividades, navegação entre áreas e ausência de overflow.

Essa verificação combina inspeção de formulários e regressão automatizada; não substitui teste de uso
com pessoas da equipe nem comprova, sozinha, que todo fluxo de trabalho futuro será intuitivo.
