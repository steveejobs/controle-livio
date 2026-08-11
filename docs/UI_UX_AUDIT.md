# Auditoria de intuitividade e ergonomia

Atualizado em 2026-08-09.

## Diagnóstico atual

O sistema está em um nível **funcional, mas ainda não altamente intuitivo**. A base tem bons sinais:
fluxos nomeados por domínio, busca global com debounce, estados de carregamento/erro/vazio, foco
visível, navegação responsiva e mensagens que não inventam dados quando a API não suporta uma tela.

Os principais atritos observados são:

- a rota inicial usa `features/app/legal-crm.tsx`, um componente muito grande, enquanto existe um
  dashboard modular separado que não é o shell ativo;
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

1. Dividir o restante de `legal-crm.tsx` em features por domínio (`auth`, `clients`, `matters`, `work`, `reports`,
   `admin`) sem alterar contratos da API.
2. Fazer o shell modular do dashboard ser a composição principal, ou remover a duplicidade após uma
   decisão de produto registrada.
3. Transformar busca em combobox acessível com `aria-controls`, `aria-expanded`, `aria-activedescendant`
   e anúncio de resultados.
4. Adicionar testes de acessibilidade e E2E em ambiente Supabase descartável; isso continua bloqueado
   pela ausência de Docker/Playwright nesta máquina.
5. Substituir gradualmente literais de cor de `globals.css` por aliases dos tokens, validando contraste
   e estados de foco a cada módulo.

## Critério de intuitividade para as próximas entregas

Uma tarefa comum deve ser compreensível sem treinamento extra: localizar o módulo pelo nome do
domínio, enxergar o estado atual, reconhecer a ação primária, receber feedback após agir e conseguir
desfazer/corrigir por um caminho explícito. Toda tela precisa manter foco visível, estados de erro e
vazio, alvo confortável e funcionamento a 360 px.
