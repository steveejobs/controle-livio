# Contexto vivo do projeto Lívio

Última atualização: 2026-10-20

## Estado atual

Controle Financeiro Lívio / CRM jurídico em monorepo TypeScript estrito. Supabase Database, Auth,
Storage e RLS são a única plataforma persistente. NestJS mantém regras críticas, Prisma é ORM tipado,
`supabase/migrations` é o único histórico executável e `packages/db/prisma/migrations` é arquivo.

## Fundação Supabase desta etapa

- Auth legado removido do runtime: sem login próprio, Argon2, sessão opaca ou CSRF próprio.
- Next usa `@supabase/ssr`; login, refresh, logout, convite e recuperação usam Supabase Auth.
- API valida Bearer JWT pelo Supabase e resolve profile → membership → organização → roles/permissões.
- `profiles`, `organization_members` e `organization_member_roles` suportam múltiplas organizações.
- `users` permanece como identidade operacional compatível com FKs; `password_hash` é nullable e não
  recebe novos valores. `sessions`/`password_reset_tokens` são legado inativo.
- RLS cobre as 36 tabelas originais e as três novas. Portal cliente é restrito por `client_id`; nota
  interna não é visível. Tabelas históricas permanecem append-only.
- Storage `legal-documents` é privado, paths novos começam em `organizations/{organizationId}` e a
  leitura exige metadata/autorização além do path. Signed URL dura cinco minutos na API.
- Service role existe somente em serviços server-side de Storage/Auth Admin e no bootstrap.
- `supabase/seed.sql` cria duas organizações e dados/usuários fictícios para todas as roles.
- `bootstrap:admin` provisiona Auth, profile, organização, membership, role e permissões com safeguards.
- `test:supabase` cobre isolamento A/B, roles, nota interna, insert/update/delete cruzado e Storage.
- O projeto Supabase remoto configurado foi inicializado a partir do zero com o histórico oficial. A
  inspeção de 2026-08-11 confirmou 39 tabelas públicas com RLS habilitada e forçada, 141 policies,
  bucket `legal-documents` privado e zero objetos. O usuário Auth confirmado agora está vinculado à
  organização `bandeira`, com profile, usuário operacional, membership ativa, papel Administrador e
  126 permissões.

## Migrations oficiais

1. `20260807134500_initial_foundation.sql`;
2. `20260807170000_finance_document_links.sql`;
3. `20260807180000_supabase_auth_rls.sql`;
4. `20260809120000_auth_memberships_hardening.sql`;
5. `20260812150000_authenticated_table_grants.sql`.

`finance_document_links` foi auditada e preserva documento→contrato, documento→despesa,
despesa→cliente, índices, FKs restritivas e tenant triggers. Em 2026-08-09, as quatro migrations foram
aplicadas ao projeto Supabase remoto configurado, que estava vazio, usando conexão explícita e os
safeguards do repositório. O dry-run listou somente essas quatro migrations; nenhum seed, reset, DROP,
TRUNCATE ou dado real foi executado. O vínculo persistente da CLI não foi gravado porque a CLI rejeitou
o timestamp retornado pela API, mas isso não impediu a aplicação versionada por `--db-url`.

## Validação desta etapa

- A etapa funcional de 2026-08-12 adicionou telas operacionais para cadastro, pesquisa e edição de
  clientes, contatos, visão financeira do cliente, comprovantes privados vinculáveis a pagamento,
  observações visíveis ao cliente e notas internas. Recebíveis podem ser gerados com entrada e até 240
  parcelas sem cálculo monetário em ponto flutuante; pagamentos são alocados com idempotência e os
  relatórios podem ser consultados e exportados em CSV pela interface.
- O dashboard passou a mostrar seis meses de contas a receber, com previsto, recebido, saldo e número
  de parcelas. Alertas `IN_APP` idempotentes cobrem títulos vencidos e vencimentos nos próximos sete
  dias, são reconciliados no acesso autenticado e preservam o estado de leitura.
- Administração ganhou reconciliação auditada dos papéis Administrador, Advogado, Secretaria,
  Financeiro e Cliente e cadastro de profissionais por convite. O convite direciona à definição e
  confirmação de senha; login, logout e recuperação continuam no Supabase Auth. A navegação e as ações
  novas são filtradas pelas permissões resolvidas da membership.
- O caminho crítico de autenticação trocou a consulta remota `getUser` por validação de claims via JWKS
  com `getClaims`; a API Vercel foi fixada em `gru1` e leituras GET da web têm cache curto de 15 segundos
  isolado por token e organização, invalidado por mutações/logout. Isso reduz chamadas Auth remotas e
  recargas de dados sem relaxar tenant ou permissões.
- As funções de negócio reutilizam o modelo existente. A prova RLS no Supabase descartável revelou que
  faltavam grants DML básicos para o papel `authenticated` alcançar as policies; a migration de grants
  concede somente `SELECT`, `INSERT`, `UPDATE` e `DELETE`, sem `TRUNCATE` ou privilégios administrativos.
  O gate local após as mudanças passou em format check, lint, TypeScript
  estrito, 41 testes automatizados, Prisma validate e builds completos da API e web. O artefato Next
  respondeu HTTP 200; a interface compacta foi inspecionada em 360/390 px e as novas seções usam o
  observer compartilhado com `opacity`/`transform` e reduced motion.
- O primeiro CI desta etapa aprovou integralmente o job da aplicação. O job Supabase chegou a iniciar
  o stack e aplicar migrations/seed, mas revelou que `auth.email.enable_signup = false` desativava o
  login por e-mail dos usuários locais. A configuração foi corrigida para manter o provedor de e-mail
  ativo e bloquear novos cadastros pelo `auth.enable_signup = false`; isso afeta somente o stack local
  descartável, não a configuração Auth hospedada.
- O CI final aprovou os jobs `application` e `supabase-isolation`. A stack descartável aplicou as cinco
  migrations e comprovou login de todos os papéis, isolamento entre organizações, negação de mutações
  cruzadas, restrições do portal/secretaria/financeiro e upload/download privado no Storage. A quinta
  migration está validada em desenvolvimento, versionada e ainda não foi aplicada ao projeto remoto,
  pois o safeguard exige autorização adicional explícita para migration de produção.

- Auditoria de prontidão repetida em 2026-08-11 sobre instalação limpa por `npm ci`: format check,
  lint, TypeScript agregado, Prisma validate, 19 testes da API, 8 testes shared e builds completos de
  shared/db/ui/API/Next passaram. `npm audit --omit=dev` encontrou zero vulnerabilidades conhecidas.
- O primeiro typecheck da auditoria falhou porque os junctions locais de `node_modules/@livio/*`
  apontavam para uma cópia antiga do repositório. `npm ci` recriou os links para o checkout atual e a
  esteira passou; um ambiente de CI limpo continua necessário para tornar essa reprodução automática.
- Smoke dos artefatos compilados passou: API `live`/`ready` responderam `ok` contra o Database remoto
  e a página Next respondeu HTTP 200. Rota privada sem Bearer respondeu 401 com envelope seguro, sem
  stack trace; origem CORS não confiável não recebeu `Access-Control-Allow-Origin`.
- A inspeção remota somente leitura confirmou as quatro migrations oficiais, 39/39 tabelas com RLS
  habilitada e forçada, 141 policies, bucket privado, zero objetos e zero hashes de senha legados.
- O bootstrap remoto vinculou o usuário Auth confirmado à organização `bandeira`. A primeira tentativa
  excedeu o timeout padrão e foi integralmente revertida; inserts idempotentes em lote e timeout remoto
  explícito foram adicionados, e a repetição concluiu. Login real, `/auth/me` e `/admin/users` passaram;
  a API resolveu 126 permissões e `users:manage`.
- Signup público foi desabilitado e a senha mínima remota foi elevada para 12 caracteres. Site URL
  e redirect allowlist do Auth agora apontam para a web HTTPS publicada na Vercel. Custom SMTP ainda
  não foi configurado. A credencial administrativa atual precisa ser rotacionada antes da abertura
  pública.
- A URL pública da API agora é obrigatória no build Next e carregada explicitamente da raiz/plataforma.
  A web recebeu CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` e
  `X-Content-Type-Options`; smoke confirmou HTTP 200 e todos esses headers.
- A exportação CSV usa o cliente autenticado, baixa o Blob sem expor token em URL e possui estados de
  progresso/erro. O endpoint protegido respondeu 200 em smoke autenticado.
- `test:supabase` foi executado e abortou pelo safeguard de URL local. Docker/Podman continuam
  indisponíveis, portanto a prova local real de RLS/Storage permanece pendente nesta máquina. O script
  agora carrega `.env` opcionalmente e o workflow `Quality` sobe Supabase descartável para executá-lo.
- CI versionado executa instalação limpa, format, lint, TypeScript, 19 testes API, 11 shared, 2 web,
  Prisma validate, build e um job separado de RLS/Storage. O workflow só será comprovado no GitHub
  depois do push. O roteiro agnóstico de provedor está em `docs/DEPLOYMENT.md`.
- Os primeiros deploys Vercel da API executaram `nest build` isoladamente, sem compilar os pacotes
  internos, causando erros em cascata de `@livio/shared`/`@livio/db`. A configuração passou a declarar
  explicitamente os presets `nextjs` e `nestjs`, com projetos separados em `apps/web` e `apps/api` e
  builds ordenados `build:web`/`build:api`. A API usa o suporte nativo da Vercel a NestJS como uma
  única Function com Fluid compute; ambos os projetos incluem fontes externas ao Root Directory.
- O crash `FUNCTION_INVOCATION_FAILED` do deploy de 2026-08-12 foi reproduzido nos logs como Prisma
  `P1001`: a Function tentava o endpoint direto IPv6 do Database Supabase. `DATABASE_URL` de runtime
  passou a usar Supavisor transaction mode na porta 6543, com `pgbouncer=true&connection_limit=1`;
  `/v1/health/live` e `/v1/health/ready` responderam HTTP 200 no deploy corrigido.
- A Vercel agora possui dois projetos reais: `controle-livio` para `apps/api` e `controle-livio-web`
  para `apps/web`, ambos conectados ao mesmo repositório. A web respondeu HTTP 200 com headers de
  segurança e a API confirmou CORS para sua origem. A raiz da API responde 404 normal, sem crash.
- Os installs Vercel incluem dependências de build mesmo com `NODE_ENV=production`; `.vercelignore`
  impede upload de `.env*`, `chaves` e metadados locais. O Next usa o adaptador nativo da Vercel com
  tracing a partir da raiz do monorepo, sem forçar artefato `standalone`.
- Logs HTTP passaram a redigir token OIDC, assinatura de proxy e `forwarded` da Vercel. A validação
  final repetiu format check, lint, TypeScript, Prisma validate, 19 testes API, 11 shared, 2 web e os
  builds completos; todos passaram.
- A URL compartilhada `https://controle-livio.vercel.app` pertence ao projeto da API e, portanto,
  devolvia 404 na raiz apesar de `/v1/health/live` estar saudável. `apps/api/vercel.json` agora define
  redirecionamento permanente somente de `/` para `https://controle-livio-web.vercel.app`, para o
  CDN armazenar o salto por um dia; `/v1/*`
  permanece na API sem alteração. O smoke do deploy confirmou 308 na raiz, página final HTTP 200 com
  título `Controle Financeiro Lívio` e HTTP 200 em `/v1/health/live` e `/v1/health/ready`.
- Rate limit distribuído, antimalware, telemetria/alertas e ensaio de backup/restauração continuam
  ausentes.

- Prisma format/generate: passou.
- Lint e TypeScript agregado: passaram após a migração de Auth.
- Docker não está instalado/disponível nesta máquina; portanto `supabase start`, reset, seed e testes
  RLS/Storage reais ainda não foram executados aqui. Os scripts estão versionados, mas a fundação só
  pode ser declarada verde após essa execução em máquina/CI com Docker.
- Validação final após a última alteração de código: format check, lint, TypeScript agregado, Prisma
  validate, 19 testes da API, 11 testes shared, 2 testes web e builds completos de
  shared/db/ui/API/Next passaram.
- A inspeção cloud posterior às migrations confirmou as quatro versões no histórico, 39/39 tabelas com
  RLS forçada, nenhuma tabela pública sem RLS, 141 policies e nenhum hash de senha legado.
- O build final foi repetido depois do ajuste de configuração pública do frontend e passou. O Next
  carrega da raiz do monorepo somente URL e chave anônima públicas; service role não é lida pelo build.
- O smoke test encontrou e corrigiu a ausência de `AuditModule` nos módulos que injetam `AuditService`.
  Depois da correção, a API iniciou com o artefato compilado e os endpoints `/v1/health/live` e
  `/v1/health/ready` retornaram `ok` usando o Database Supabase cloud.
- `supabase start` foi tentado duas vezes e falhou antes de criar containers porque Docker e Podman não
  existem no PATH. Logo, migrations/seed/testes RLS reais permanecem preparados mas não executados.

## Implementação operacional de 2026-08-12

- A auditoria completa das abas deixou de tratar presença de endpoint como equivalência de produto
  pronto. Agenda, Tarefas, Documentos, Contratos e Pipelines agora possuem operações de escrita
  compatíveis com as permissões da API; Processos ganhou cadastro e atualização operacional, e o
  filtro do CRM jurídico passou a usar exclusivamente pipelines `LEGAL`. Processos sem pipeline ou
  vinculados a uma etapa que deixou de existir permanecem visíveis em uma tabela operacional, em vez
  de desaparecerem do quadro.
- A área financeira mantém criação de entrada/parcelas/pagamentos e passou a expor despesas, ajustes
  aprovados de parcelas e estorno auditado. Relatórios agora mostram todos os doze contratos de
  relatório da API e só exibem exportação a perfis com `reports:export`.
- A tela administrativa agora respeita separadamente `users:manage`, `roles:view` e `roles:manage`,
  permite suspender/reativar profissionais e executar explicitamente a reconciliação dos papéis de
  sistema. O convite continua dependendo do SMTP do Supabase, que ainda precisa de configuração e
  validação próprias em produção.
- Perfis vinculados a cliente agora recebem a aba `Minha área`, com leitura/download apenas de
  documentos liberados como `CLIENT` e troca de observações pelo canal de mensagens existente, sem
  depender de acesso ao cadastro geral de clientes.
- Corrigido o isolamento da visão agregada de cliente: cada coleção interna só é consultada quando a
  sessão possui sua permissão específica, e documentos de perfil cliente também exigem visibilidade
  `CLIENT`. A rota autenticada `/auth/me` deixou de depender indevidamente de `notifications:view`.
- Alertas financeiros agora respeitam `actor.clientId`. Uma Vercel Cron diária protegida por
  `CRON_SECRET` reconcilia parcelas e lembretes de tarefas vencidos para todos os destinatários
  ativos; o endpoint falha fechado quando o segredo não foi configurado. E-mail/WhatsApp continuam
  fora do escopo até existir provedor, consentimento, templates e política de retentativas.
- Os módulos operacionais são carregados sob demanda pelo Next, reduzindo o JavaScript necessário no
  login e na primeira renderização. Estados vazios de Auditoria e das novas telas são explícitos, sem
  spinner infinito.
- Validação final desta etapa: format, lint, TypeScript, Prisma validate, 45 testes e builds locais
  passaram. O commit `c8c38ed` foi publicado nos dois projetos Vercel e o workflow `Quality`
  correspondente concluiu com sucesso, inclusive no job descartável de RLS/Storage.
- Smoke de produção confirmou redirecionamento 308 da URL compartilhada, web 200 com o título
  esperado, `live`/`ready` 200, cron sem segredo 401 e 401 para as rotas protegidas de clientes,
  agenda, tarefas, documentos, financeiro, relatórios, auditoria, usuários e notificações. Não houve
  resposta 5xx nos logs do período validado. Em três amostras aquecidas, a web respondeu em
  125–247 ms e a API em 150–235 ms; os nove scripts iniciais somaram 249.934 bytes comprimidos,
  abaixo dos 255.235 bytes medidos antes da divisão dos módulos.
- `CRON_SECRET` está configurado como segredo de produção no projeto da API e a agenda diária está
  publicada. O teste de fumaça não executou o cron autenticado nem mutações com dados reais para não
  gerar notificações ou registros artificiais na organização de produção.

## Invariantes

1. Tenant nunca vem do navegador sem membership validada.
2. Dinheiro é Decimal/string, nunca ponto flutuante nativo.
3. Supabase é a única plataforma de Database/Auth/Storage.
4. Service role nunca chega ao browser e não substitui RLS.
5. Binários ficam em bucket privado; banco guarda path e metadata, nunca URL pública persistente.
6. Migrations remotas, bootstrap, seed e reset obedecem safeguards por ambiente.
7. Ferramentas locais preservam originais e não imprimem segredos.

## Riscos restantes

- Executar `test:supabase` em Docker/Supabase local; a máquina atual ainda não possui Docker/Podman.
- Rotacionar a credencial administrativa atual antes da abertura pública.
- Configurar custom SMTP e validar convite, login, refresh, recuperação e templates no staging
  publicado; Site URL e redirect HTTPS já estão configurados.
- Alertas desta etapa são internos e possuem reconciliação diária na Vercel, com `CRON_SECRET`
  configurado. Envio por e-mail/WhatsApp exige provedor, consentimento, templates e política de
  retentativas ainda não definidos.
- Definir domínios próprios, se exigidos pelo produto, e atualizar CORS, URL pública da API e
  redirects antes da troca dos aliases `vercel.app`.
- Adicionar scanner antimalware, rate limit distribuído, telemetria e alertas antes de produção.
- Ensaiar backup/restauração separados de Database e Storage.
- Uma simulação E2E autenticada pontual foi executada em 2026-10-20 contra o projeto de desenvolvimento,
  com organização QA isolada e mutações sintéticas. Ainda falta versionar essa simulação como suíte
  automatizada; a execução local da prova RLS/Storage continua dependendo de Docker ou Podman.

## Troca do projeto Supabase em 2026-10-20

- O projeto Supabase `ioebcdpyrszokdyaoaqv` foi confirmado pelo responsável como ambiente novo de
  desenvolvimento/homologação, sem dados a migrar. A inspeção prévia encontrou zero tabelas públicas,
  usuários Auth, buckets e objetos. O projeto anterior não foi modificado nesta troca.
- As URLs fornecidas para os dois poolers continham uma senha diferente da senha de banco fornecida
  separadamente. A conexão foi corrigida e validada por `SELECT 1`. O `.env` local ignorado pelo Git
  e as variáveis da Vercel usam a URL corrigida de transaction pooler para runtime; a URL de session
  pooler foi usada somente para migrations. Valores de credenciais não foram versionados.
- O dry run da Supabase CLI listou apenas as cinco migrations oficiais. Com autorização específica para
  as substituições de políticas, trigger e constraint da migration de Auth/RLS, as cinco foram
  aplicadas ao projeto novo, sem seed, reset ou remoção de tabelas/dados. A inspeção posterior confirmou
  39/39 tabelas públicas com RLS habilitada e forçada, 141 policies, bucket `legal-documents` privado,
  nenhum objeto e nenhum hash de senha legado.
- O Auth remoto foi configurado com a web HTTPS como Site URL, redirects local/publicado, signup público
  desabilitado e senha mínima de 12 caracteres. Um convite foi criado para o administrador informado;
  o bootstrap vinculou uma membership ativa à organização `bandeira`, um papel Administrador e 126
  permissões. A API e a web da Vercel receberam variáveis do novo projeto em Production e Preview.
- O build local, format check, lint, TypeScript, Prisma validate e 45 testes automatizados passaram
  após instalação limpa. O build da web publicada incluiu somente o project ref novo nos scripts.
  `/v1/health/live` e `/v1/health/ready` responderam 200 na API publicada, CORS aceitou a origem da
  web e uma rota protegida sem Bearer respondeu 401. A web publicada respondeu 200 e a raiz da API
  redirecionou com 308.
- A região da Function da API mudou de `gru1` para `cle1` para coincidir com `us-east-2` do banco novo;
  o deploy foi inspecionado e mostrou a Function em `cle1`. Auth Admin e Storage responderam usando a
  nova chave server-side; leitura anônima de organizações não retornou dados.
- O lockfile recebeu atualizações compatíveis via `npm audit fix`: Next passou para 16.4.2 e a cadeia
  de dependências de produção passou de 13 alertas (dois críticos) para cinco (zero críticos, três
  altos). Os cinco restantes exigem migrações de versão principal do Prisma ou Swagger; não foi usado
  `--force`. Format, lint, TypeScript, Prisma validate, os 45 testes e os builds completos passaram
  após essa atualização. Os dois projetos Vercel foram republicados com o lockfile novo.
- O smoke final dos aliases publicados confirmou web 200 com título e CSP, somente o project ref novo
  nos scripts, `/v1/health/ready` 200 e redirecionamento 308 da raiz da API para a web.
- A entrega do convite por e-mail e o fluxo autenticado no navegador dependem da aceitação do convite
  e ainda precisam de confirmação. Custom SMTP não está configurado. Os alertas restantes do audit e
  os riscos gerais de produção documentados acima devem ser resolvidos antes de uso sensível real.

## Simulação autenticada do sistema em 2026-10-20

- A simulação usou a organização QA isolada `qa-simulation-20261020150139`, com usuário administrador
  e usuário cliente sintéticos. Os dados de teste permanecem identificados nessa organização para
  revisão; não foram enviados convites nem mensagens de e-mail.
- A cobertura da API passou por autenticação e permissões, dashboard, clientes/contatos, processos,
  pipelines/etapas, notas internas e mensagens, tarefas/comentários/lembretes, agenda/prazos, contratos,
  recebíveis/parcelas, pagamentos/idempotência/estorno, ajustes/renegociação, despesas, upload e versão
  de documentos privados, notificações, os 12 relatórios/CSV, administração de papéis, estado de usuário
  e auditoria. Os alertas vencidos e de próximos vencimentos foram reconciliados duas vezes; a leitura
  foi preservada sem duplicar notificações.
- No navegador real, as 16 abas do administrador e as 11 abas disponíveis ao cliente abriram. Em 360 px,
  o menu móvel abriu/fechou, não houve overflow horizontal e a navegação continuou operável. Os fluxos
  pela interface criaram cliente, tarefa com prazo, comentário e lembrete, prazo na agenda, recebível,
  pagamento, despesa, documento e mensagem do portal.
- A validação do portal confirmou escopo de um único cliente, documento `CLIENT` visível, documento
  interno oculto e bloqueio 403 para notas internas. A exportação CSV autenticada baixou o arquivo; os
  12 relatórios foram selecionados sem erro visível.
- A simulação encontrou e corrigiu erro real em operações financeiras: IDs de parcelas eram enviados
  como texto para uma comparação UUID no PostgreSQL. O bloqueio agora tipa cada ID como UUID e as
  transações financeiras seriais têm limites explícitos de espera de 10 s e execução de 30 s. O fluxo
  completo de ajuste, pagamento parcial, repetição idempotente, estorno e renegociação passou na API
  publicada; o valor renegociado conferiu com R$ 110,00. A correção foi publicada na API Vercel.
- Após essa correção passaram format check, lint, TypeScript, 46 testes automatizados, Prisma validate e
  builds completos. A prova de isolamento RLS/Storage diretamente no projeto continua pendente: Docker
  e Podman não estão instalados nesta máquina e o safeguard bloqueia o runner remoto. Convite/recuperação
  por e-mail não foram exercitados: isso enviaria e-mail externo e o custom SMTP ainda não está configurado.

## Revisão mobile e instalação em 2026-10-20

- A web agora oferece instalação como PWA pelo navegador, usando manifest com `standalone`, ícones PNG
  192/512 px (incluindo maskable), ícone SVG e metadados Apple. O botão está no login e na navegação
  autenticada. Chrome/Edge podem apresentar prompt nativo quando disponível; nos demais casos, o diálogo
  mostra como adicionar à tela inicial no iPhone/iPad, Android ou computador.
- No menu mobile, Escape fecha a navegação e devolve foco ao controle de abertura; ao abrir, o foco vai
  ao primeiro destino e a rolagem de fundo fica bloqueada. Selecionar destino e usar o backdrop também
  fecham o menu.
- QA local com Chrome em 360 e 390 px confirmou largura do documento igual à janela, formulário sem
  corte, diálogo de instalação e ciclo de foco/rolagem do menu. Rotas da web e do manifest, além dos
  ícones, responderam 200. Format check, lint, TypeScript, 46 testes, Prisma validate e build completo
  passaram após esta etapa.
- A entrega é instalável pelo navegador e continua online; não cria APK/EXE nem inclui leitura offline.
  A experiência de instalação varia por navegador, e iPhone/iPad usam o fluxo manual de Compartilhar >
  Adicionar à Tela de Início.

## Desempenho e eficiência em 2026-10-20

- O quadro de processos foi extraído do shell e passou a carregar sob demanda; a lista de clientes do
  cadastro de processo só é requisitada quando o formulário abre. Medição local do build web caiu de
  10 para 9 scripts iniciais e de 251.592 para 249.065 bytes gzip (redução de 1,0%). O novo
  `npm run perf:bundle` limita o JavaScript inicial a 260.000 bytes no workflow `Quality`.
- A web deixou de reconciliar notificações no login. A central reconcilia na primeira abertura,
  reutiliza o resultado por cinco minutos e mantém atualização manual. Browser QA com respostas
  isoladas confirmou 0 POSTs no login, 1 na primeira abertura, 0 extras na reabertura e 1 atualização
  manual; o cadastro de processos só requisitou clientes após abrir o formulário. Em 360 px não houve
  overflow horizontal.
- O cliente API agora compartilha GETs simultâneos no mesmo escopo, respeita cancelamento individual,
  cancela o transporte quando nenhum leitor resta, limita o cache a 80 entradas e impede que leituras
  antigas repovoem o cache após escrita/logout. Testes cobrem concorrência, cancelamento e corrida
  entre leitura e escrita.
- A reconciliação financeira agrega pagamentos e ajustes somente das parcelas elegíveis, filtra
  notificações financeiras anteriores no banco e evita `UPSERT` quando conteúdo ativo não mudou. O
  cron processa no máximo oito destinatários em paralelo. Comparação SQL somente leitura no projeto
  de desenvolvimento confirmou linhas iguais para a organização QA (5 alertas) e um cliente (2).
  `EXPLAIN ANALYZE` do conjunto pequeno registrou 0,983 → 0,315 ms e 0,217 → 0,203 ms,
  respectivamente; não extrapolar esses tempos para bases grandes. Nenhuma migration ou escrita em
  dados reais foi executada nesta medição.
- Após as mudanças passaram format check, lint, TypeScript, 51 testes automatizados, Prisma validate,
  build completo e o orçamento de bundle. Ainda faltam métricas reais de p95/Web Vitals e carga
  concorrente com volume representativo antes de afirmar ganhos em produção. Detalhes e método estão
  em `docs/PERFORMANCE.md`.
- Um smoke HTTP local limitado a GET registrou web 50/50 respostas 200 (p95 77 ms), API liveness
  10/10 (p95 15 ms) e API readiness 30/30 sob cinco chamadas simultâneas (p95 4.796 ms). O readiness
  sequencial ficou em p95 930 ms. A instância local usa o transaction pooler remoto com
  `connection_limit=1`, portanto as consultas de readiness concorrem pela mesma conexão; esse dado
  não representa a latência da Function Vercel próxima ao banco. A ferramenta de smoke foi limitada
  a URL HTTP local, GET, 100 requisições e oito simultâneas por segurança.
- A regressão mobile de processos/notificações foi versionada em Playwright e adicionada ao CI.
  Usa API simulada, não acessa o Supabase, e valida navegação em 360 px, foco/Escape, ausência de
  overflow, carregamento de clientes sob demanda e contagem de reconciliações. Ainda não cobre todas
  as 16 abas nem substitui a simulação ampla autenticada no projeto de desenvolvimento. Após sua
  inclusão, passaram novamente format check, lint, TypeScript, 51 testes unitários, Prisma validate,
  build completo, orçamento de 249.065/260.000 bytes gzip e o E2E no Chrome local.

## Senhas e visibilidade em 2026-10-20

- Login, nova senha e confirmação agora têm controle acessível de mostrar/ocultar, independente por
  campo, com botão de pelo menos 44 px e operação por teclado. O formulário de nova senha exige
  6 caracteres e mantém a confirmação de igualdade antes do envio.
- O mínimo local do Supabase e a validação do bootstrap passaram a 6. No projeto remoto de
  desenvolvimento/homologação `ioebcdpyrszokdyaoaqv`, a Management API confirmou a mudança de
  `password_min_length` de 12 para 6 após atualização; a política de caracteres segue sem exigência
  adicional. Nenhuma senha nem token foi registrado neste arquivo.
- Um mínimo de 6 facilita senhas fracas. A decisão foi solicitada para este ambiente; deve ser
  reavaliada antes de abrir acesso público. O E2E de senha cobre visibilidade, teclado, validação
  HTML de 5/6 caracteres e layout em 360 px; a entrega de e-mail de recuperação continua dependente
  de SMTP e não foi exercitada nesta etapa.
- Após a alteração passaram format check, lint, TypeScript, 51 testes unitários, Prisma validate,
  build completo, gate de bundle (249.295/260.000 bytes gzip), 3 testes E2E no Chrome local e
  `git diff --check`. A configuração remota de Auth foi lida novamente e confirmou mínimo 6.
- Com aprovação explícita, a web foi publicada na Vercel Production para o projeto
  `controle-livio-web`, com alias `https://controle-livio-web.vercel.app`. O build remoto concluiu e
  smoke no domínio público respondeu 200 para `/` e `/reset-password`; no Chrome em 360 px, o login
  mostrou a senha, a nova senha também alternou visibilidade após hidratação, o campo exibiu
  `minlength=6` e não houve overflow horizontal. O vínculo local da raiz voltou ao projeto da API
  após a publicação; o vínculo de `apps/web` permanece na web.
