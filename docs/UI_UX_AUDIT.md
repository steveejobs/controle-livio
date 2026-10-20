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

1. Dividir o restante de `legal-crm.tsx` em features de autenticação, busca e navegação sem alterar
   contratos da API.
2. Fazer o shell modular do dashboard ser a composição principal, ou remover a duplicidade após uma
   decisão de produto registrada.
3. Transformar busca em combobox acessível com `aria-controls`, `aria-expanded`, `aria-activedescendant`
   e anúncio de resultados.
4. Ampliar a suíte E2E versionada para os demais fluxos autenticados e acrescentar testes de
   acessibilidade. O fluxo mobile de processos e notificações já roda no CI com API simulada; a
   simulação ampla no projeto de desenvolvimento foi manual e a suíte RLS/Storage ainda depende de
   Docker ou Podman.
5. Substituir gradualmente literais de cor de `globals.css` por aliases dos tokens, validando contraste
   e estados de foco a cada módulo.

## Critério de intuitividade para as próximas entregas

Uma tarefa comum deve ser compreensível sem treinamento extra: localizar o módulo pelo nome do
domínio, enxergar o estado atual, reconhecer a ação primária, receber feedback após agir e conseguir
desfazer/corrigir por um caminho explícito. Toda tela precisa manter foco visível, estados de erro e
vazio, alvo confortável e funcionamento a 360 px.
