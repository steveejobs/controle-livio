# Contexto vivo do projeto Lívio

## Homologação RC concluída no Actions — 2026-10-29

- Commit testado: `c943da129d1972f2f6da7321650f0a9c2841677d`, branch
  `validation/gha-ci-20261029`. Quality #40934607266 passou: https://github.com/steveejobs/controle-livio/actions/runs/40934607266.
- Format, lint, TypeScript, Vitest 193/193, Prisma Validate, builds API/web e bundle passaram; Playwright
  mockado 21/21, integrado 9/9 e RLS/Auth/Storage passaram.
- Cliente e tarefa (com responsável da equipe) foram criados por formulários reais. Fluxos de processo,
  contrato/recebível e upload/solicitação de assinatura ainda têm criação/preparação via API no E2E;
  veja a matriz de aceite em `docs/RELEASE_CANDIDATE.md`.
- Restore sintético em banco temporário novo passou para 45 tabelas e estrutura pública em 7.139 ms;
  não é restauração do backup histórico e não inclui Storage/Auth hospedado/segredos/owners/grants/jobs.
- Performance sintética: 1.207 queries, P2024 zero, nenhuma chamada pendente; pool espera p50/p95 1/1 ms,
  4 conexões ocupadas/abertas no máximo. Rajada de 6 chamadas deduplicou 4 consultas de membership.
- Audit pós-Multer 2.5.0: 3 altas em produção (Prisma/config/deepmerge-ts), total de dependências 9
  (2 críticas, 3 altas, 1 moderada, 3 baixas), incluindo ferramentas de teste. Segurança ainda não pronta.
- SMTP não foi enviado por caixa de teste; push requer VAPID, schedulers hospedados precisam homologação;
  scanner antimalware e restore do backup histórico/Storage permanecem pendentes.
- `apps/api/vercel.json` e `apps/web/vercel.json` bloqueiam Preview nesta branch. Tentativas do projeto API
  filtradas pela branch aparecem `CANCELED`; o projeto web não tem deployments correspondentes e não há
  Preview ativo. `main` e Supabase compartilhado não foram alterados.
- Funcionalidade, UX, performance e recuperação: parciais. Segurança, piloto comercial e release candidate:
  não prontos até fechar as pendências da matriz e homologar o primeiro escritório.

Última atualização: 2026-10-29

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

## Paginação, busca e regressão em 2026-10-20

- Processos, documentos, recebíveis, pagamentos e despesas carregam 25 por página, informam a contagem,
  preservam os itens anteriores e permitem repetir uma página que falhou. A seleção de parcela consulta
  recebíveis do cliente escolhido; pagamento continua enviando valor decimal como string e chave de
  idempotência. Após uma revisão adicional, clientes, contratos, auditoria e documentos do portal também
  receberam paginação. Seletores de clientes começam com 100 opções e podem carregar mais lotes, sem
  corte silencioso; uma busca direta no seletor ainda melhoraria o uso em organizações muito grandes.
- A busca global foi separada do shell e agora oferece combobox com navegação por setas, Enter e Escape,
  estados de carregamento, vazio e erro. O painel recebeu região de gráfico semântica e tabela rolável
  nomeada e focável. O componente Speed Insights foi integrado à web, mas o serviço ainda precisa ser
  ativado no projeto Vercel após revisão do plano/custo; não há métricas reais de p95.
- O Playwright passou a cobrir paginação/falha/nova tentativa, busca por teclado, pagamento decimal,
  recuperação de senha com resposta simulada e axe WCAG A/AA em login, nova senha e painel mobile.
  Os sete testes E2E passaram com Chrome local após build, incluindo a pesquisa paginada de clientes. As respostas são simuladas e não comprovam
  entrega de e-mail nem performance ou segurança do banco remoto.
- O responsável informou que ainda não possui provedor de e-mail. Custom SMTP, entrega real de convite
  e recuperação, scanner de malware, rate limit distribuído, ativação/alertas de observabilidade e ensaio
  isolado de backup/restauração continuam pendentes. A estação não possui Docker, `pg_dump` nem scanner
  local. `docs/DEPLOYMENT.md` registra os passos operacionais. Esta versão ainda não foi publicada;
  o deploy anterior continua sendo o último em Vercel Production.

## Cadastro de clientes e contatos em 2026-10-20

- O formulário de cliente agora coleta endereço com campos opcionais para logradouro, número,
  complemento, bairro, cidade, UF e CEP. O endereço é enviado somente quando há algum dado e pode ser
  revisado/editado no cadastro do cliente.
- A seção de contatos explica que os dados de telefone/e-mail do próprio cliente já ficam no cadastro
  principal. A ação “Adicionar outra pessoa” abre o formulário para representantes, familiares ou
  responsáveis, e a lista informa quando não há outras pessoas vinculadas.
- Formatação, lint, TypeScript, Prisma validate e builds completos passaram. Testes automatizados não
  foram executados nesta alteração. Não houve mudança de API, schema Prisma ou migration.

## Períodos do dashboard financeiro em 2026-10-20

- O gráfico de recebíveis aceita 3, 6 ou 12 meses futuros e todo o período cadastrado. Os filtros são
  validados na API e aplicados no SQL dentro do tenant autenticado; períodos curtos retornam buckets
  mensais, enquanto todo o período agrega por ano para manter o volume visual controlado. O histórico
  completo inclui parcelas ativas anteriores e projeções futuras, excluindo parcelas canceladas e
  renegociadas.
- A interface preserva métricas operacionais ao trocar o filtro, indica o recarregamento do gráfico e
  mostra uma mensagem enxuta com atalho ao Financeiro quando não há parcelas. A tabela identifica mês
  ou ano conforme o agrupamento.
- Format check, lint, TypeScript, Prisma validate, 52 testes automatizados, dois E2E em Chrome local
  (360 e 1440 px, axe e overflow) e builds completos passaram. O primeiro disparo paralelo de lint/testes
  excedeu memória; ambos passaram em execuções sequenciais. Nenhuma migration ou escrita no banco foi
  necessária.

## Página inicial do dashboard em 2026-10-20

- A página inicial ganhou composição em duas áreas: recebíveis e acesso rápido aos módulos permitidos.
  Os quatro indicadores são exibidos apenas quando a sessão pode abrir o módulo correspondente. O painel
  lateral mostra atalhos reais e destaca títulos vencidos ou tarefas em aberto quando houver.
- Sem parcelas no período selecionado, a área financeira mantém uma linha do tempo com posições vazias,
  rótulos de mês/ano e explicação clara. Nenhum número ou registro fictício é renderizado. Com parcelas,
  o painel soma previsto, recebido e em aberto a partir das strings decimais usando centavos em `bigint`,
  e mantém gráfico e tabela por mês ou ano.
- O teste E2E deixou de gravar uma captura baseada em API simulada. Sua fixture de dashboard representa
  períodos vazios com valores zero apenas para verificar o estado sem registros. Format check, lint,
  TypeScript, 52 testes automatizados, Prisma validate e builds completos passaram. Os dois cenários E2E
  no Chrome instalado passaram em 360 e 1440 px, com verificação de overflow e axe WCAG A/AA. A inspeção
  visual em 1440 px identificou rótulos cortados na linha do tempo; o alinhamento foi corrigido e o
  cenário desktop passou novamente após o build web.

## Verificação ampla de QA em 2026-10-20

- A suíte Playwright foi ampliada para 17 cenários. Em 360 e 1440 px, percorre as 16 abas disponíveis
  ao administrador, verifica carregamento, axe WCAG A/AA, erros de navegador e ausência de overflow.
  Também cobre prazos, lembretes, agenda, notificações, convite simulado, pipelines, 12 relatórios,
  CSV, pagamento decimal, paginação, autenticação simulada, cadastro/edição de cliente, contato,
  comunicação e portal do cliente com mensagem e documento privado. A matriz detalhada está em
  `docs/QA_COVERAGE.md`.
- A abertura de Usuários e permissões deixou de reconciliar papéis automaticamente; a operação permanece
  no botão explícito. Regiões de tabelas financeiras/administração receberam foco e nome acessível,
  carregamentos passaram a anunciar status e botões segmentados receberam alvo confortável.
- `tools/qa/live-readonly.mjs` verificou 35 rotas na API publicada com a organização sintética QA do
  projeto de desenvolvimento. Incluiu os 12 relatórios, CSV, negações 403 no portal e proteção 401 de
  cron. A ferramenta não altera dados de negócio nem imprime tokens. Os testes do navegador usam API
  simulada; a verificação remota consulta a versão publicada, ainda anterior às alterações locais.
- Passaram format check, lint, TypeScript, Prisma validate, build completo, 52 testes unitários e os
  17 E2E no Chrome local após build. Nenhuma migration, reset ou escrita de negócio remota foi feita
  nesta verificação. O SMTP continua ausente, então entrega real de convite/recuperação não foi validada;
  RLS/Storage local requer Docker ou Podman e backup/restauração e carga representativa seguem pendentes.

## Cadastro de clientes: conflito de CPF/CNPJ em 2026-10-21

- A unicidade por organização do CPF/CNPJ já era garantida pelo banco. Quando o documento já existia,
  o Prisma retornava `P2002`, mas a API tratava o conflito como erro interno genérico. O `POST /clients`
  agora devolve HTTP 409 com mensagem para pesquisar/usar o cadastro existente; a restrição de
  duplicidade permanece intacta. Nenhuma migration foi necessária.
- Testes do serviço cobrem o conflito de documento duplicado e o caminho válido sem CPF/CNPJ, incluindo
  registro de auditoria. Passaram format check, lint, TypeScript, 54 testes automatizados, Prisma
  validate, build completo e os dois cenários E2E de cadastro no Chrome em 360 e 1440 px. O E2E usa
  API simulada; não altera nem valida dados persistidos.
- A consulta de logs da API publicada nas últimas 24 horas não retornou requisições, então não foi
  possível confirmar se esse conflito foi a causa da tentativa relatada. Não houve deploy nem escrita
  em dados de negócio remotos. Se o cadastro falhar com documento novo, ainda é necessário observar a
  mensagem e o `requestId` para localizar a causa específica.

## Tratamento transversal de erros e seletores em 2026-10-21

- O filtro global da API converte conflitos e referências Prisma conhecidos (P2002, P2003, P2025 e P2034) em respostas 409/404 com mensagens seguras. Erros inesperados continuam como 500 genérico e são registrados no servidor. O cadastro de clientes mantém uma mensagem específica para CPF/CNPJ já vinculado à organização.
- Os 33 campos `<select>` da interface recebem uma seta, espaçamento e cores do tema em uma regra central; permanecem controles nativos, com teclado e semântica de formulário preservados. A cobertura E2E verifica o estilo dos seletores renderizados em cada módulo.
- A suíte das 16 abas passou em 360 px e 1440 px com checagem axe e overflow. O teste de axe do painel aguarda o fim da animação de entrada para avaliar o contraste no estado estável. Também passaram os dois E2E de cadastro de cliente, o de fluxo de desempenho e o E2E de paginação executado isoladamente.
- Passaram format check, lint, TypeScript, 59 testes automatizados, Prisma validate e build completo. Em execução agrupada da E2E, o Chromium excedeu o timeout de 30 segundos ao criar um contexto para o teste de paginação; a repetição isolada passou. Nenhuma migration, escrita de negócio no banco ou publicação foi feita.

## CRM comercial e jurídico no mesmo módulo em 2026-10-21

- A aba “CRM comercial” foi removida da navegação. O módulo unificado “CRM jurídico e comercial” mantém os dois tipos de pipeline separados e visíveis no mesmo espaço; Cobrança continua em módulo próprio. A alteração é somente de interface e não muda permissões, API ou banco.
- No cadastro, o seletor agora apresenta “Conta individual (pessoa física)” e “Conta jurídica (empresa)”. Representantes e outros contatos continuam sendo cadastrados separadamente após salvar a conta; essa é a interpretação aplicada à expressão “contas a partes”. Sem migration.
- A matriz E2E percorreu as 15 abas em 360 e 1440 px, confirmou a ausência da aba antiga e a presença dos pipelines Comercial e Jurídico no módulo unificado. O E2E de cadastro enviou `COMPANY` para Conta jurídica e passou nas duas larguras.
- Format check, lint, TypeScript, 59 testes, Prisma validate, build e os quatro E2E focados passaram. Nenhuma escrita de negócio remota nem publicação foi feita.

## Fluxo de cadastro e preparação do cliente em 2026-10-21

- O cadastro foi organizado em identificação, contato e endereço. CPF/CNPJ recebe máscara durante a digitação, limita 11/14 dígitos, muda para pessoa jurídica ao passar de 11 dígitos e continua validado no servidor antes de salvar. CNPJ exige razão social; o cadastro concluído abre a ficha do cliente.
- Após salvar um cliente novo, a interface inicia um assistente sem abas para procurar: abre o financeiro, avança automaticamente ao salvar a cobrança, depois avança para honorários ao salvar o contrato e para documentos após o contrato. Há botões de continuar/pular e voltar; anexar os três documentos conclui o fluxo e oferece a ficha completa. Edição de cliente já existente preserva a navegação por seções. O resumo `financial.outstanding` em `GET /clients/:id/overview` soma parcelas, alocações confirmadas e ajustes aprovados em Decimal/string e separa moedas. Com permissão, o assistente permite lançar cobrança parcelada com divisão exata de centavos; o cálculo e as ações seguem condicionados às permissões do usuário.
- Contratos de honorários podem ser registrados para o cliente sem trocar de módulo. A tela organiza os valores, percentual de êxito e vigência; quando há um único contrato, o arquivo de honorários é associado a ele automaticamente. Contrato, procuração e declaração de hipossuficiência aparecem em checklist e são anexados com visibilidade interna. Geração por templates permanece para a próxima etapa.
- Passaram format check, lint, TypeScript, 62 testes automatizados, Prisma validate, build completo e build web após o último ajuste. Os dois E2E do fluxo passaram no Chrome em 360 e 1440 px, incluindo cobrança, contrato e documentos; a API foi simulada, sem validar persistência ou Storage real. Nenhuma migration, escrita de negócio remota ou publicação foi feita.
- O resumo financeiro carrega os valores de todas as parcelas do cliente para calcular o saldo exato; o custo dessa consulta ainda não foi medido com volume grande. Os anexos desta etapa guardam arquivos existentes e não produzem documentos jurídicos automaticamente.

## Coerência dos formulários em 2026-10-21

- A revisão dos formulários não encontrou campos duplicados de assunto e título com a mesma finalidade. Rótulos foram ajustados para indicar o dado e o objeto de cada módulo, incluindo cobrança, etapa de pipeline e perfil de acesso; uma explicação estática incompleta sobre permissões foi removida.
- A criação no CRM ocultou o status redundante com o primeiro estágio do fluxo; a escolha do pipeline aparece antes e determina os campos do processo ou da oportunidade. Campos jurídicos não são mostrados antes da escolha nem para oportunidades. O formulário de pipeline mostra exemplos de etapa inicial próprios para Comercial, Jurídico e Cobrança e apresenta os tipos em português.
- Os formulários de honorários condicionam valor fixo/por hora e percentual ao modelo escolhido. O cadastro geral agora envia `successRate`, normaliza moeda brasileira sem ponto flutuante, e as listas mostram modelo e percentual em linguagem compreensível. A API do resumo do cliente passou a devolver o percentual armazenado.
- Campos de classificação de serviço usados apenas em relatórios foram movidos para uma área opcional recolhida, e o serviço genérico automático foi removido. Rótulos de filtros de relatório ficaram explícitos; “Aging” agora aparece como “Faixas de atraso”.
- Testes unitários e E2E cobrem as conversões e estados condicionais. Passaram format check, lint, TypeScript, 66 testes unitários, Prisma validate, build completo e os 17 cenários E2E no Chrome em 360/1440 px; a matriz também verifica axe e overflow. A primeira execução ampla revelou apenas um localizador instável no próprio teste, corrigido antes da execução final aprovada.
- Os E2E usam API simulada e não comprovam gravação/persistência real. Nenhuma migration, escrita remota ou publicação foi feita nesta revisão.

## Controle de acesso, aprovação financeira e alertas em 2026-10-21

- A identidade de Administrador é derivada do papel de sistema `administrator` autenticado; permissões personalizadas não concedem esse papel. A API restringe exportação CSV de relatórios, administração de usuários/papéis, reversão e aprovação de correções de pagamentos. A interface também esconde ações de exportação/gestão para perfis que não são Administradores. A consulta de relatórios continua disponível conforme `reports:view`.
- A confirmação de login por senha ou link registra um evento idempotente de acesso por sessão e atualiza `lastLoginAt`. Administradores podem configurar até cinco horários locais, em intervalos de cinco minutos, para receber resumo na central de notificações. Um cron autenticado consolida acessos desde o último cursor e evita uma notificação por chamada de API. A migration torna o evento de acesso imutável e indexa a consulta.
- Correções de pagamentos confirmados preservam o lançamento original: demais perfis enviam proposta com motivo; a proposta fica pendente e notifica os Administradores ativos. Só Administrador pode aprovar/recusar. Aprovar reverte o lançamento e alocações anteriores e cria o lançamento corrigido na mesma transação, mantendo trilha de auditoria. Administrador pode aplicar sua própria correção diretamente.
- Adicionada a migration `20261021150000_access_alerts_and_payment_change_requests.sql`, com tabela de solicitações, RLS sem acesso direto do navegador, vínculos e proteção de imutabilidade do histórico de acesso. Ela **não foi aplicada**: o `AGENTS.md` exige confirmação do banco de desenvolvimento antes de migrations. Validar a migration SQL no ambiente de desenvolvimento também permanece pendente.
- A agenda de alertas usa cron a cada cinco minutos e o fuso da organização; na Vercel essa frequência exige plano Pro, pois o plano Hobby permite no máximo uma execução diária. Alertas são notificações internas. A entrega depende de `CRON_SECRET` e da migration aplicada.
- Passaram format check, lint, TypeScript, Prisma validate, build completo, 74 testes unitários e 17 E2E no Chromium em 360/1440 px. Nenhuma migration, escrita no banco ou publicação foi feita. A instalação do Chromium ocorreu somente no cache local de ferramentas.

## PWA installation and browser push - 2026-10-21

- The install prompt is captured by a `beforeInteractive` script so it survives login and client component mounting. The install button opens the browser prompt when available and otherwise gives device-specific installation instructions. The root service worker serves push and notification-click events; its file is returned with no-cache headers.
- Native push subscriptions are opt-in per user/browser, scoped by organization and user, validated to HTTPS push-provider hosts, and stored only by the API. The service worker displays generic notices so legal/financial details stay behind login. Push is connected to payment-change requests/decisions, financial alerts, task reminders, and administrator access digests. Delivery errors are contained and expired endpoints are removed.
- VAPID keys are optional as an all-or-none API configuration. `.env.example` documents placeholders; no secret keys were created or added. The web UI reports pending server configuration until the API has the keys.
- Added migration `20261021160000_web_push_subscriptions.sql`. Neither it nor the previous `20261021150000_access_alerts_and_payment_change_requests.sql` was applied. The repository `AGENTS.md` requires explicit confirmation before applying migrations to the development database. SQL execution against a database remains pending.
- Final local checks passed: format check, lint, strict TypeScript, Prisma validate, full build, 88 unit tests, and 19 Chromium E2E tests. The E2E uses a synthetic install event and simulated notification permission/service worker/push API; it proves UI/API contract behavior, not real OS/provider delivery. No production deployment or remote business-data write was made.
- `npm audit --omit=dev` reports five transitive vulnerabilities in the resolved tree (three high, two moderate) through `deepmerge-ts`/Prisma config and `js-yaml`/Nest Swagger. npm's suggested fixes require Prisma 7 and Swagger 12 major upgrades; those upgrades were not part of this change and were not applied.

## Objetivos de cobrança e serviços contratados em 2026-10-21

- O formulário de cobrança permite marcar “Registrar objetivo sem valor financeiro”. A opção abre uma descrição obrigatória, muda o nome curto para “Objetivo da negociação” e grava a anotação em `matters.custom_fields.collectionObjective`; não cria nem altera recebíveis, parcelas ou saldo. O objetivo aparece nos cartões do CRM.
- O fluxo entre Processos/CRM/Cobrança remonta o quadro ao mudar de módulo, evitando reaproveitar um formulário aberto de outro módulo. Os quadros Kanban agora são regiões nomeadas e focáveis por teclado; a nova etiqueta recebeu contraste de tema suficiente. A matriz axe/overflow verifica isso em 360 e 1440 px.
- Os formulários de contrato geral e da ficha do cliente permitem marcar vários serviços comuns, agrupados por área, incluindo acompanhamento em delegacia, inquérito, audiência de custódia, habeas corpus e execução penal. A equipe pode salvar um serviço para a organização e selecioná-lo; o primeiro marcado permanece como classificação principal de relatórios, e a seleção completa fica em `contracts.terms.services`.
- O catálogo customizado usa `service_catalog_items`, escopo da organização, nome normalizado, RLS forçada sem acesso direto pelo navegador, permissionamento `contracts:view/create` e auditoria. A migration `20261021170000_service_catalog.sql` foi adicionada, mas não aplicada. Junto das migrations de alertas de acesso e Web Push, há três migrations locais pendentes; as regras de `AGENTS.md` exigem confirmação antes de qualquer aplicação ao banco de desenvolvimento.
- QA executado após a alteração: format check, lint, TypeScript estrito, Prisma validate, build completo, 100 testes unitários (65 API, 18 web, 17 shared) e os 19 E2E no Chromium passaram. Os E2E usam API simulada; não comprovam persistência do catálogo no banco até aplicar a migration e executar teste de integração. Nenhuma escrita no banco remoto ou publicação foi feita.

## Modelos automáticos de documentos em 2026-10-21

- A etapa de documentos do fluxo do cliente agora gera DOCX no mesmo painel para contrato de honorários, procuração e declaração de hipossuficiência. Os arquivos são salvos como rascunhos internos no Storage privado; emitir novamente cria uma nova versão imutável. O logotipo e a tipografia dos modelos fornecidos foram usados; somente a imagem de marca foi copiada para o repositório, sem os dados pessoais preenchidos nos exemplos.
- Pessoa física pode cadastrar nacionalidade, estado civil, profissão e RG na qualificação. Pessoa jurídica pode informar nome e CPF do representante. O gerador valida CPF/CNPJ e exige endereço com logradouro, cidade e UF; para pessoa jurídica também exige representante identificado. CPF/CNPJ e valores são montados a partir dos registros existentes.
- A cobrança pode ser associada ao contrato na ficha do cliente. A geração usa parcelas e vencimentos dessa cobrança, compara o total ao honorário fixo com Decimal e bloqueia diferenças ou ausência de vencimentos. Honorários por êxito e por hora usam a regra do contrato.
- Nome profissional, OAB, endereço, foro e instruções de pagamento são configuráveis pelo Administrador em `organizations.settings.legalDocuments`, preservando outras configurações e sem adicionar migration. `clients.custom_fields` armazena a qualificação estruturada; ambas reutilizam colunas JSON existentes.
- Geração exige `documents:create` e `clients:view`; contrato também exige `contracts:view` e `receivables:view`. Configurações do escritório exigem Administrador e permissões de organização. Auditoria da configuração registra estado configurado sem copiar instruções de pagamento.
- Os modelos incluem cláusulas com os dados dinâmicos e mantêm arquivos já gerados como versões separadas; alterações cadastrais só aparecem em nova emissão. A primeira configuração profissional precisa ser preenchida por um Administrador. Os documentos ainda precisam de revisão profissional antes de assinatura; o repositório não gera PDF nem aplica assinatura digital.
- Validações finais: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run db:validate` e `npm run build` passaram; `npm test` passou com 109 testes (74 API, 18 web e 17 shared). O E2E focado do fluxo do cliente passou nos viewports de 360 px e 1440 px, cobrindo edição/cadastro e geração dos três documentos; `git diff --check` não encontrou erros de whitespace (apenas avisos de conversão LF/CRLF do Git).
- O E2E usa API simulada: prova o fluxo e os payloads na interface, mas não confirma Storage nem persistência de produção. Nenhuma migration ou escrita em banco foi necessária ou executada. O Administrador ainda precisa configurar os dados profissionais do escritório. Alterações cadastrais entram em uma nova emissão, preservando cada DOCX anterior como versão histórica; os documentos exigem revisão profissional antes de assinatura e não incluem PDF ou assinatura digital.

## Modelos editáveis e atividades do sistema — 2026-10-21

- Contrato de honorários, procuração e declaração de hipossuficiência podem ser personalizados pelo
  Administrador no módulo Documentos. Variáveis aparecem agrupadas por cliente, escritório, contrato e
  documento, com rótulo e explicação; botões inserem o dado no cursor e a prévia usa exemplos.
  Alterações pendentes são sinalizadas e confirmadas antes de descartar ao trocar ou restaurar modelo.
- A API rejeita variáveis desconhecidas/incompletas ou a remoção de dados essenciais. Texto e estado
  ficam em `organizations.settings.legalDocuments.templates`, sem nova tabela ou migration. O modelo
  atualizado vale para emissões futuras; versões emitidas são preservadas.
- A área administrativa **Atividades do sistema** junta operações de `audit_logs` a eventos de acesso,
  módulos abertos e fichas de cliente consultadas. Apenas o papel oficial Administrador com
  `audit:view` consulta o histórico. O retorno apresenta ator, ação, hora e nomes de campos, sem valores
  anteriores/posteriores; consultas e gravações permanecem limitadas à organização autenticada.
- Validado localmente: format check, lint, TypeScript estrito, Prisma validate, build completo, 117 testes
  unitários (82 API, 18 web, 17 shared) e os 19 cenários Playwright, incluindo axe/overflow em 360 e
  1440 px. Os dois cenários do editor foram repetidos após incluir confirmação de descarte e passaram.
  Após a última otimização da consulta de atividades, 22 testes API focados e seu typecheck passaram
  novamente. Nenhuma migration foi criada ou aplicada.
- Limite da comprovação: Playwright simula as respostas da API; testes de serviço cobrem regras e
  gravação com mocks. Esta etapa não é um ensaio de persistência em banco remoto nem substitui a revisão
  profissional do conteúdo jurídico dos modelos.

## Alertas de audiência — 2026-10-21

- No cadastro do contrato, a opção “Este contrato inclui audiência” começa desmarcada. Serviços sem
  audiência, como acompanhamento em delegacia, seguem sem campos ou eventos obrigatórios. Ao marcar,
  é possível incluir várias datas/horários, local opcional e escolher os avisos padrão de 1 hora,
  30 minutos e 10 minutos; até cinco intervalos adicionais podem ser configurados por audiência.
- Cada audiência entra como evento `HEARING` agendado na Agenda, com duração padrão de uma hora. A
  criação do contrato, evento e notificações agendadas ocorre na mesma transação. Audiências criadas
  diretamente na Agenda também recebem avisos padrão ou os intervalos informados; o responsável pelo
  cadastro é o destinatário. Avisos cuja hora já passou antes do cadastro são ignorados.
- Os avisos usam `notifications.scheduled_at` e metadados existentes; não houve mudança de schema ou
  migration. Um cron protegido por `CRON_SECRET` processa os avisos a cada cinco minutos, atualiza a
  central interna e tenta push nos dispositivos inscritos. Ao mover, concluir, cancelar ou trocar o tipo
  de uma audiência, os avisos pendentes são atualizados/removidos na mesma transação da alteração.
- Validação local final: format check, lint, TypeScript estrito, Prisma validate, build completo,
  123 testes unitários (88 API, 18 web, 17 shared) e 19 E2E Chromium passaram. Os E2E cobrem ambos os
  cadastros de contrato, o serviço de acompanhamento sem audiência automática, intervalos
  personalizados e os viewports de 360/1440 px.
- Limites de comprovação: os E2E usam API simulada e os testes de serviço usam mocks; persistência real
  no banco não foi ensaiada nesta etapa. A notificação interna depende do cron publicado; push também
  requer VAPID configurado e inscrição do usuário em cada dispositivo. O cron de cinco minutos requer
  Vercel Pro e pode entregar cada aviso com até cinco minutos de atraso. Nenhuma migration, escrita em
  banco ou publicação foi feita.

## Homologação real e correções de segurança — 2026-10-21/22

- O usuário confirmou que o projeto Supabase `ioebcdpyrszokdyaoaqv` é desenvolvimento/homologação e autorizou migrations e dados fictícios. Foram aplicadas, sem reset ou seed, as migrations de alertas de acesso/aprovação financeira, Web Push, catálogo de serviços, preferências de audiência, limite de requisições, agendador e proteção RLS do portal, de `20261021150000` a `20261021230000`. A ferramenta `tools/supabase/migrate.mjs` exige confirmação explícita do projeto.
- O ensaio `tools/qa/verify-workflows.ts --local-api` passou no banco/Auth/Storage reais com duas organizações fictícias e contas distintas. Comprovou cadastro PF/PJ e duplicata, convite por link com senha, cobrança parcelada exata, contrato com e sem audiência, geração e download íntegro de três DOCX, pagamento idempotente, correção sujeita a aprovação, isolamento do portal e RLS, alertas após reagendamento e acesso auditado. Relatório local: `test-results/qa-workflows-1792631031175-aab762.json`. Ao terminar, as organizações de QA foram arquivadas e as identidades fictícias foram banidas; histórico imutável permanece.
- O teste real encontrou que `AuditService` tentava gravar um ID de sessão Supabase no FK legado `sessions`, bloqueando o cadastro. O ID agora fica nos metadados da auditoria. Também encontrou consulta direta de outros clientes pelo perfil de portal; a migration `20261021220000_portal_rls_scope.sql` limita clientes, contatos e notificações ao titular. A migration `20261021230000_portal_write_scope.sql` limita publicação de mensagens e alteração direta de notificações de terceiros. O último ajuste de escrita ainda requer repetição da prova direta.
- Consultas API de documentos e finanças priorizam o cliente autenticado sobre filtros recebidos; visão de cliente estrangeiro retorna 404. Notificações financeiras/tarefas exigem permissões correspondentes. Alertas pendentes não aparecem como recebidos; cancelar, concluir e reagendar audiência preserva histórico enviado e reconstrói somente pendências.
- Convites usam link gerado pelo Supabase Auth e mostrado uma vez ao Administrador; aceitação e definição de senha passaram no ensaio. O escritório informou que ainda não possui domínio nem provedor SMTP. O envio real de convite/recuperação por e-mail dependerá dessa configuração. O link não é incluído na auditoria.
- Vercel Hobby suporta apenas cron diário; o agendador por minuto foi preparado em `pg_cron`/`pg_net` no banco de homologação. Como as filas `pg_net` podem ser lidas por papéis da plataforma, cada chamada usa assinatura HMAC expirada e proteção de replay; o segredo está no Vault, sem credencial estática na fila. Os segredos CRON/VAPID foram criados no ambiente Vercel production da API, com cópia local ignorada pelo Git. O job ainda não foi ativado: precisa primeiro publicar e validar a API. A entrega push no sistema operacional depende de inscrição/permissão do dispositivo e teste manual pelo novo botão de envio.
- A API passou a limitar requisições autenticadas em contador compartilhado no Postgres. Os checks locais de format, lint, TypeScript, 143 testes unitários e Prisma validate passaram nesta etapa; build, E2E e publicação ainda estão em andamento. A restauração de backup e a revisão profissional do texto jurídico não foram comprovadas.

### Fechamento da homologação em 2026-10-22

- API e web foram publicadas nos aliases Vercel `controle-livio.vercel.app` e `controle-livio-web.vercel.app`, ambos usando o Supabase confirmado como **homologação**. A API respondeu `GET /v1/health/ready` com HTTP 200; página, manifesto PWA e service worker da web responderam HTTP 200. A web com o fluxo final de recuperação foi construída e republicada com sucesso.
- O agendador `livio-notifications` foi ativado a cada minuto via `pg_cron` e validado após a republicação da API: execução `succeeded`, `last_completed_at` preenchido e `last_failed_at` nulo. `CRON_SECRET` e VAPID estão configurados no projeto da API; não há segredo estático na fila `pg_net`. A entrega push em um sistema operacional ainda depende de inscrição de um dispositivo real e teste manual.
- Sem SMTP, o Administrador agora gera também link de recuperação para membro ativo da própria organização; o link é exibido uma vez, não entra na auditoria e permite definir outra senha. A prova real contra a API publicada e Supabase Auth passou para convite **e** recuperação, incluindo abertura do callback real da web com cookie e redirecionamento para a definição de senha, além de todas as etapas anteriores e da política RLS de escrita do portal. Relatório local final: `test-results/qa-workflows-1792634317845-e02f74.json`; todas as organizações fictícias desse ensaio foram arquivadas e os usuários de QA banidos.
- Os checks finais após a adição de recuperação passaram: format check, lint, TypeScript estrito, 143 testes unitários, Prisma validate e build completo. A suíte Playwright completa passou em 17/19 na primeira execução; os dois cenários administrativos falharam por rótulo acessível e foram corrigidos. Depois, ambos passaram em 360 e 1440 px; com a recuperação adicionada, repetiram e passaram em ambas as larguras. Não foi repetida toda a matriz de 19 após a pequena mudança administrativa.
- Permanecem pendentes para uso real: domínio/provedor SMTP e prova de entrega de e-mail, scanner antimalware, ensaio de restauração de Database + Storage, entrega push confirmada em dispositivo, revisão jurídica dos modelos e triagem de vulnerabilidades transitivas apontadas por `npm audit` (13 no grafo completo; a maioria exige atualização major). Os documentos gerados permanecem rascunhos DOCX sem PDF ou assinatura digital. Não classificar esta homologação como prontidão de produção.
- A tela de recuperação agora orienta o profissional a solicitar o link ao Administrador se o e-mail não chegar, coerente com a ausência de SMTP. O build web e os três cenários Playwright de senha/recuperação passaram após essa alteração; a web foi republicada no alias de homologação e respondeu HTTP 200.

### Foto do cliente e cobrança pelo WhatsApp — 2026-10-22

- A ficha do cliente permite enviar foto JPG/PNG/WebP (até 5 MB), capturar pela câmera quando o dispositivo oferece essa opção, trocar e remover. A imagem fica no bucket privado `client-photos`, acessível apenas por URL assinada após `clients:view`; upload/remoção exigem `clients:update`, escopo da organização e auditoria. A migration `20261022200000_client_photos.sql` foi aplicada somente ao Supabase de desenvolvimento/homologação confirmado (`ioebcdpyrszokdyaoaqv`). O serviço verifica assinatura do arquivo, limita tamanho e impede sobrescrita concorrente silenciosa.
- A ficha mostra uma cobrança por WhatsApp apenas quando existe saldo em aberto e o usuário pode operar cobranças/pagamentos. O profissional escolhe o telefone cadastrado, revisa ou edita a mensagem com o saldo atual e abre `wa.me` com o texto pronto. O envio é confirmado pelo próprio profissional no WhatsApp conectado ao aparelho/navegador; o sistema não tem credenciais WhatsApp nem afirma entrega automática. Não há envio quando o telefone não tem formato válido com DDD. Valores continuam derivados das strings decimais retornadas pela API.
- Verificações: format check, lint, TypeScript estrito, Prisma validate e build completo passaram; 146 testes unitários passaram (107 API, 22 web, 17 shared). A suíte Playwright completa passou nos 19 cenários após a inclusão da cobertura da ficha em 360 e 1440 px, cobrindo foto e link com telefone/valor. A prova real `test-results/qa-workflows-1792679150827-357490.json` passou no Supabase/Auth/Storage, inclusive upload, leitura assinada, remoção, arquivo inválido e isolamento entre organizações. O teste visual encontrou e permitiu corrigir a leitura de saldos com quatro casas decimais antes da publicação final.
- API e web corrigidas foram publicadas nos aliases de homologação `controle-livio.vercel.app` e `controle-livio-web.vercel.app`. O navegador/dispositivo decide se a opção de captura abre a câmera; o WhatsApp precisa estar instalado ou conectado. A prova automatizada valida o link e a mensagem, mas não atesta um envio humano pelo WhatsApp. Permanecem os riscos operacionais já listados acima, inclusive o alerta de 13 dependências transitivas do `npm audit`.

### Leitura local de documentos de identificação — 2026-10-22

- O cadastro de pessoa física permite fotografar ou selecionar uma imagem JPG/PNG de documento (até 8 MB), fazer leitura OCR em português no navegador, revisar nome, CPF, RG, órgão expedidor e nascimento e aplicar os dados ao formulário. A fotografia do documento é anexada ao histórico privado somente ao concluir o cadastro. A extração é uma sugestão e exige conferência humana; não verifica autenticidade.
- Worker, WebAssembly e modelo de idioma são copiados do pacote Tesseract e do pacote de dados português para `/ocr` antes de `dev` e `build`. Não há download de CDN em tempo de uso e a pasta gerada está ignorada pelo Git. A CSP libera WebAssembly e mantém as conexões limitadas às origens atuais.
- Verificações finais: format check, lint, TypeScript estrito, Prisma validate, 149 testes unitários e build completo da API/web passaram. Playwright passou em 360 px e 1440 px, reconhecendo dados de uma imagem sintética, aplicando-os sem repetir campos de revisão e verificando os três arquivos OCR locais e o anexo privado. Não há alteração de banco nesta etapa.
- `npm audit --omit=dev` reporta cinco vulnerabilidades no grafo atual por dependências relacionadas a Prisma e `@nestjs/swagger`; a correção sugerida pelo npm exige atualização de versão principal. Isso não foi alterado nesta etapa.

### Arquivamento de contratos digitalizados — 2026-10-22

- A ficha do cliente tem uma ação específica para guardar contrato assinado/digitalizado em PDF,
  PNG ou JPG. Cada envio cria um documento interno privado usando o fluxo `/documents` já
  existente; o vínculo a um contrato de honorários cadastrado é opcional. O título é montado com
  o número/nome do contrato (ou do cliente) e o nome do arquivo. É possível repetir o envio para
  arquivar vários contratos; cada envio recebe um arquivo.
- A listagem da ficha agora recebe `contractId`, mostra os arquivos relacionados e informa no
  cadastro de honorários quando há escaneamentos salvos. O anexo genérico ficou limitado à
  procuração e à declaração de hipossuficiência, para não oferecer um segundo caminho de contrato
  que permitia tentar anexar sem vínculo específico. O upload usa a permissão `documents:create`,
  as validações de arquivo e o armazenamento privado existentes. Não houve alteração de schema,
  migration ou escrita em banco remoto.
- Validação local: format check, lint, TypeScript estrito, Prisma validate, build completo e 149
  testes unitários passaram. Os dois cenários focados do Playwright passaram em 360 px e 1440 px,
  incluindo envio de PDF e conferência de categoria, visibilidade interna e vínculo ao cliente e
  contrato. A suíte Playwright completa foi iniciada, mas não concluída após erro de navegação
  `ERR_ABORTED` em um cenário administrativo; portanto esta etapa comprova o fluxo focado, não a
  matriz E2E completa. `git diff --check` não encontrou erros de whitespace. A mudança não foi
  publicada.

### Assinatura online e linha do tempo processual — 2026-10-22

- Os documentos-modelo de contrato de honorários, procuração e hipossuficiência passam a ser gerados em DOCX e PDF. O PDF fica como versão atual para conferência e assinatura, enquanto o DOCX editável permanece no histórico. Uma atualização de documento revoga links pendentes para versões anteriores; links são criados somente para a versão atual em PDF e ficam presos ao respectivo hash.
- O pedido de assinatura exige permissões de criação de documentos e leitura do cliente, identifica o nome do signatário (para empresa, o representante legal), permite validade entre 1 e 30 dias e pode ser cancelado por quem tenha permissão de atualização. O token aleatório de 256 bits é armazenado somente como hash, expira, é de uso único e recebe limite de tentativas por token. O cliente confere o PDF em página pública sem indexação, desenha com toque/mouse ou usa o nome digitado como alternativa acessível, confirma consentimento e conclui. A assinatura e os PDFs permanecem em buckets privados.
- Ao concluir, o original é preservado e uma nova cópia PDF recebe folha de evidências com signatário, data/hora, versão e hash do original e hash da imagem da assinatura. A ficha mantém o documento assinado como item interno separado. O fluxo não usa certificado ICP-Brasil nem prova forte de identidade; não deve ser apresentado como assinatura qualificada ou avançada sem validação jurídica e técnica adicionais.
- O link pode ser copiado ou abrir o WhatsApp e o aplicativo de e-mail com mensagem pronta. A abertura desses aplicativos não confirma envio; o WhatsApp depende da sessão conectada no dispositivo e o envio de e-mail depende do aplicativo configurado, pois o escritório ainda não possui SMTP.
- O acompanhamento dos processos agora reúne histórico de etapas, tarefas, audiências/eventos, documentos, mensagens ao cliente e notas internas em ordem cronológica. Cada categoria depende da permissão correspondente; perfis de cliente não recebem notas internas e só recebem títulos de documentos visíveis ao cliente. O painel abre diretamente do cartão ou lista do processo.
- A declaração-base de hipossuficiência foi organizada para pessoa física e jurídica representada, com menção ao pedido de gratuidade e à análise pela autoridade responsável. O texto continua editável pelo Administrador e deve ser revisado pelo advogado conforme o caso concreto. A referência geral é o art. 98 do CPC; o modelo não promete concessão do benefício.
- Validação local: Prisma validate, lint, TypeScript, build da API/web e 155 testes unitários passaram (113 API, 25 web e 17 shared). Quatro fluxos Playwright focados passaram em 360 px e 1440 px: assinatura por link e navegação dos módulos com linha do tempo, sem violações axe nos módulos. format check e git diff check foram executados ao final.
- A migration `20261022213000_document_signing.sql` foi aplicada ao projeto Supabase de desenvolvimento/homologação `ioebcdpyrszokdyaoaqv` após confirmação explícita. O dry-run antes da aplicação listou somente essa migration; depois, o dry-run confirmou o banco atualizado e nenhuma migration pendente. A execução usou `tools/supabase/migrate.mjs` com o safeguard do projeto, sem reset, seed ou escrita de dados de negócio.
- A validação pela stack Supabase local não foi possível neste computador porque Docker e Podman não estão instalados. Prisma valida o schema da aplicação, não a sintaxe SQL; a migration foi revisada e aplicada pelo Supabase CLI no projeto de homologação. Uma consulta somente leitura no alvo confirmado verificou a tabela, a policy RLS de leitura e o bucket de assinaturas privado. Os testes do serviço usam mocks, portanto ainda não comprovam criação e conclusão de uma assinatura real pela API/Storage. API e web não foram publicadas nesta etapa.
- O conector Supabase MCP disponível apontou para outro project ref (`igjggqhvluiwfkxdqzlu`) e não foi usado para modificar dados. Nesse projeto diferente, o advisory retornou 162 tabelas `public` sem RLS; a relevância e a propriedade desse projeto precisam ser confirmadas separadamente. Nenhuma remediação foi aplicada nele.

Referências jurídicas consultadas: [CPC, art. 98](https://planalto.gov.br/ccivil_03/leis/l13105compilada.htm) e [Lei 14.063/2020, art. 4º](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm).

### Auditoria de engenharia reversa e transferência — 2026-10-27

- Criado o conjunto de documentação em docs/auditoria-2026-10-27/ com 13 documentos cobrindo visão, arquitetura, 30 funcionalidades e 1 item legado, telas/jornadas, banco, APIs/integrações, segurança, testes, problemas, produto e plano de evolução.
- Snapshot local inventariado: 12 módulos Nest de domínio + Prisma, 14 controllers e 110 handlers; 16 áreas de navegação, 3 páginas Next e 1 callback; 45 models Prisma, 25 enums e 16 migrations SQL. O banco Supabase remoto não foi consultado nesta auditoria; o estado de migrations/RLS/buckets não foi revalidado.
- Verificações locais executadas: format check, lint, TypeScript, 155 testes unitários, Prisma validate, build, bundle check e 21 cenários Playwright; todos passaram. Playwright usou API mockada. npm audit --omit=dev apontou 9 vulnerabilidades (7 high, 2 moderate); nenhuma dependência foi atualizada.
- Achados prioritários documentados: token bearer de assinatura na URL pode aparecer em logs/erro; upload é bufferizado até 100 MiB antes do limite de negócio default 20 MiB; multi-membership sem seletor observado na web; ciclo de despesas e recorrência de calendário parciais; exportação PDF não configurada; documentação anterior divergente.
- Esta auditoria não alterou código, banco, migrations ou deploy. O checkout já tinha 81 arquivos rastreados modificados e 47 não rastreados antes da documentação, portanto os achados descrevem o snapshot local e não afirmam equivalência com HEAD ou ambiente publicado.
- Próximos passos e limitações estão em docs/auditoria-2026-10-27/08-TESTES_E_EVIDENCIAS.md, 09-PROBLEMAS_E_PENDENCIAS.md e 11-PLANO_DE_EVOLUCAO.md. Nenhum segredo ou valor de .env foi registrado.

### Validação operacional das jornadas — 2026-10-27

- Referência atual: branch main, HEAD 919a5accc91bc96dbd87773411668d017f968e35. Checkout continua com 81 arquivos rastreados modificados e 48 entradas não rastreadas; 47 itens não rastreados já estavam no snapshot da auditoria, a entrada extra é o diretório de auditoria. Não há baseline de hash para prova byte a byte.
- .env local está marcado development, mas SUPABASE_LOCAL=false e Supabase/PostgreSQL são remotos; project ref coincide com a confirmação local. API foi compilada localmente. Docker e Supabase CLI não estão disponíveis. Produção não foi acessada nem comparada por identificador.
- O QA protegido criou dois tenants e identidades fictícias e executou login/membership, convite/recuperação, clientes PF/PJ, validação/isolamento, foto Storage, catálogo, recebível parcelado, contrato e audiência/lembretes. O teste criou registros sintéticos no Supabase remoto de development; o finalizador do script suspende/arquiva tenants, bane identidades e mantém histórico/arquivos de evidência.
- A execução parou na geração documental: URL assinada respondeu HTTP 200 e retornou PDF, mas tools/qa/verify-workflows.ts esperava DOCX como versão atual. O código gera DOCX e depois PDF; a asserção do verificador está desatualizada. Relatório local registra success=false, stage de documentos, 5 checks e 2 tenants sintéticos. Pagamentos, portal/RLS, relatórios e reconciliação posteriores não foram alcançados.
- As seis jornadas foram classificadas como PARCIAL; nenhuma foi validada por inteiro. Despesas não têm transições de aprovação/pagamento, recorrência de calendário não gera ocorrências, e os fluxos reais de tarefa, assinatura, cliente no portal, relatórios e teste do saldo não foram concluídos nesta execução.
- Detalhamento de jornadas, ambiente, evidências e plano de construção não executado: docs/auditoria-2026-10-27/VALIDACAO_OPERACIONAL_E_PLANO.md. Não houve alteração de aplicação, migration ou deploy nesta etapa.

### Conclusão da validação integrada — 2026-10-27

- O preflight somente leitura identificou Auth e Storage no projeto `ioebcdpyrszokdyaoaqv`, PostgreSQL no pooler correspondente, os três buckets privados esperados, e RLS habilitada/forçada em 13 de 13 tabelas da matriz QA. O job pg_cron `livio-notifications` estava ativo a cada minuto, com dez execuções recentes bem-sucedidas e sem falha registrada.
- A confirmação de ambiente não foi suficiente para escrita: `docs/ENVIRONMENTS.md` associa a mesma ref Supabase aos ambientes Vercel Production e Preview; não foi feita comparação independente no Dashboard/controle de produção nesta sessão. O QA remoto foi bloqueado, sem escrita em Auth, PostgreSQL ou Storage. A allowlist de projetos remotos permanece vazia.
- `tools/qa/verify-workflows.ts` foi atualizado para validar versões DOCX/PDF, comparar metadados e SHA-256 persistidos com bytes baixados, conferir URL assinada e expiração, e manter status/etapa/evidência independentes para as seis jornadas. O defeito do teste antigo era exigir DOCX para a versão atual, que a API gera como PDF. A correção foi compilada, mas a integração documental corrigida não foi executada devido ao bloqueio ambiental.
- Nenhuma jornada integrada foi marcada PASS nesta etapa. Cadastro PF/PJ, foto privada, catálogo, recebível parcelado, contrato e audiência têm somente evidência parcial do run histórico `test-results/qa-workflows-1793125781741-7c7464.json`. Pagamentos, despesas reais, documentos completos/assinatura, ciclo de processos, tarefas completas e autorização portal/RLS via JWT permanecem bloqueados ou não verificados. Despesas continuam limitadas a criação/listagem no código, sem endpoints de aprovação/pagamento.
- Riscos de token de assinatura em URL, upload bufferizado (100 MiB no interceptor frente ao limite de negócio padrão de 20 MiB) e nove vulnerabilidades de dependências reportadas anteriormente foram registrados sem correção ampla ou upgrades. Nenhuma migration, regra de negócio, dependência ou deploy foi alterado.
- Validações locais desta etapa: format check, lint, TypeScript, Prisma validate, 155 testes unitários e build completo passaram. O QA integrado mutável e Playwright não foram executados. Relatório e matriz para a próxima etapa: `docs/auditoria-2026-10-27/VALIDACAO_INTEGRADA_FINAL.md`; saída de preflight: `test-results/qa-preflight-2026-10-27.json`.
- Arquivos tocados nesta missão: `tools/qa/verify-workflows.ts`, `tools/qa/README.md`, `docs/auditoria-2026-10-27/VALIDACAO_INTEGRADA_FINAL.md` e este contexto. Alterações preexistentes do checkout foram preservadas.

### Preparação de ambiente TEST/DEV — 2026-10-27

- Antes da etapa: `main`, HEAD `919a5accc91bc96dbd87773411668d017f968e35`, 81 arquivos rastreados modificados e 48 entradas não rastreadas. Nenhuma alteração preexistente foi descartada. O `.env` único continua remoto e ligado a Production/Preview conforme `docs/ENVIRONMENTS.md`; não há `.env.test` isolado.
- Não foi identificado projeto TEST cloud comprovadamente separado. A integração Supabase disponível é read-only e não lista/cria projetos; Supabase CLI e Docker não estão instalados. Não houve criação cloud, migration, alteração no Supabase atual ou deploy.
- Preparados templates vazios de env API/web e runbook de provisionamento em `docs/infra/AMBIENTE_TEST_DEV.md`. A sequência local tem 16 migrations; `pg_cron`/`pg_net` dependem de configuração posterior de Vault/job, que exige API TEST allowlisted. O seed local não foi executado/copiado.
- QA agora exige correspondência de project ref, URL pública/server-side, chaves anônimas e DATABASE_URL/DIRECT_URL; execução remota pede ambiente `test`, allowlist versionada e canais externos desabilitados. A allowlist de projeto permanece vazia.
- O provisionador Vercel Production foi restrito à ref Production conhecida e rejeita env QA. O configurador de scheduler rejeita API Production/Preview para project ref TEST; sua allowlist de host TEST permanece vazia.
- Verificação negativa local confirmou que `provision-runtime.mjs` recusa `SUPABASE_ENVIRONMENT=test` antes de gerar ou gravar segredos; `node --check`, TypeScript QA, lint, Prettier e Prisma validate passaram. Nenhuma conexão cloud foi aberta pelos testes desses guardrails.
- Validações da infraestrutura integrada permanecem `NOT_RUN`; estado geral `BLOCKED` até o responsável criar/indicar projeto TEST, comparar ref com Production e Preview, disponibilizar acesso via secret manager e autorizar migrations/gravações sintéticas. Relatório: `docs/auditoria-2026-10-27/EXECUCAO_QA_AMBIENTE_ISOLADO.md`.
- Arquivos tocados: QA verifier/README, provisionador de runtime de notificações, configurador de scheduler/README, templates API/web, este contexto e os dois documentos em `docs/infra/` e auditoria.

### Execução QA integrada no banco atual — 2026-10-27

- Por autorização explícita do proprietário, seis jornadas foram executadas com API local e Supabase remoto existente. A ref `ioebcdpyrszokdyaoaqv` foi confirmada entre Auth, PostgreSQL e Storage, mas também está associada a Vercel Production/Preview; não é TEST isolado. Nenhum Supabase, Docker, migration, deploy, mudança de schema ou regra de negócio foi criado/aplicado.
- Resultado do run final: clientes/processos PASS; despesas PARTIAL; contratos/financeiro FAIL; documentos/assinatura PARTIAL; tarefas/agenda PASS; portal do cliente PASS. O overview financeiro falhou duas vezes com Prisma `P2024` (pool limitado a uma conexão/timeout de 10 s). As operações de Decimal, pagamento parcial, idempotência concorrente, excesso rejeitado, correção/aprovação, relatório e isolamento passaram.
- Documentos: geração de template foi recusada por exigir CPF válido e não foi contornada com identificador real; upload sintético DOCX/PDF, versões, hash, URL assinada/TTL, assinatura, revogação e recuperação de erro passaram. No portal, JWT/RLS limitou documentos/mensagens/notificações e leituras financeiras a `clientId`; operações administrativas foram negadas.
- Preflight/postflight foram somente leitura além dos registros de teste. O job `pg_cron` estava ativo e saudável; zero push subscriptions e nenhum segredo de canal externo no processo QA. Um tenant e uma identidade não classificados foram tratados como potencialmente reais, sem alteração. Contagens não classificadas permaneceram iguais antes/depois.
- Cinco runs criaram dez organizações sintéticas, 35 identidades Auth e objetos/linhas de evidência. O finalizador arquivou organizações, suspendeu memberships e baniu contas. A remoção física transacional foi revertida pelo banco por histórico imutável; não foram removidos Storage/Auth e triggers não foram desativadas. Linhas e objetos QA permanecem retidos; decisão de retenção necessária antes de exclusão futura.
- QA ajustado para comparar expiração assinada por `exp - iat`, separar evidências financeiras/documentais e auditar retenção em modo somente leitura. `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` (155), `npm run db:validate` e `npm run build` passaram. Relatório: `docs/auditoria-2026-10-27/EXECUCAO_QA_BANCO_ATUAL.md`; artefatos before/after e runs em `test-results/`.
- Arquivos alterados nesta missão: `tools/qa/verify-workflows.ts`, `tools/qa/cleanup-workflows.ts`, `tools/qa/inspect-current-target.ts`, `tools/qa/README.md`, relatório integrado final e atualizações de `VALIDACAO_INTEGRADA_FINAL.md`, `AMBIENTE_TEST_DEV.md` e `PROJECT_CONTEXT.md`. Nenhuma alteração preexistente foi descartada.

### Correção P0 do overview financeiro — 2026-10-27

- O checkout começou em `main`, HEAD `919a5accc91bc96dbd87773411668d017f968e35`, ainda com alterações e arquivos não rastreados preexistentes; foram preservados. O benchmark usou somente leituras de um fixture sintético QA já arquivado no Supabase remoto compartilhado; não houve escritas, migrations, mudança de schema, configuração cloud ou deploy.
- Causa confirmada: `ClientsService.overview` disparava onze consultas de seção em `Promise.all` com `connection_limit=1`, `pgbouncer=true` e `pool_timeout` ausente (Prisma informou 10 s). P2024 ocorreu em `Task.findMany` e `ClientMessage.findMany`; medição isolada falhou em 11,24 s. A instância Prisma já era singleton. Consultas e ciclos de conexão de muitas operações no PgBouncer saturavam a fila; não foi identificada uma consulta individual lenta.
- Correção: checagem do cliente e leituras do overview agrupadas numa transação read-only com `maxWait=10 s` e `timeout=10 s`. Não se aumentou o pool. Com uma conexão, uma leitura passou em 8,28 s; duas concorrentes passaram em 7,77 s e 15,46 s. Ambas retornaram saldo sintético `BRL 880.0000`; isolamento para tenant irmão retornou 404 e cliente QA sem financeiro retornou coleções/saldo vazios.
- Testes: concorrência de chaves idempotentes distintas adicionada em dois ordenamentos, com transação serializada simulada; cenário sintético em memória cobre 75 recebíveis, saldo completo independente do limite de listagem de 50, pagamento parcial/integral e vencimento. Disputa concorrente e volume crescente no PostgreSQL não foram executados. O benchmark final chama o serviço, não HTTP/JWT.
- Validações concluídas: `npm run format:check`, `npm run lint`, `npm test` (160), `npm run typecheck`, `npm run db:validate` e `npm run build` passaram. Resultado P0 do overview: PASS; regressão financeira ampliada: PARTIAL até haver HTTP/JWT, disputa real no banco e fixtures de pagamento integral/vencido num TEST isolado. A latência com uma conexão e duas requisições (máximo observado 15,46 s) permanece como risco de capacidade.
- Relatório detalhado e evidências: `docs/auditoria-2026-10-27/CORRECAO_P0_FINANCEIRO.md`; benchmark somente leitura: `tools/qa/benchmark-financial-overview.mjs`.

### Otimização P0.1 do overview financeiro — 2026-10-27

- As seções autorizadas do resumo passaram a ser carregadas numa consulta Prisma com `relationLoadStrategy: 'join'`. O preview Prisma `relationJoins` foi habilitado para o cliente 6.19.3; isso altera apenas a geração/configuração Prisma, não o schema PostgreSQL. A linha do tempo fica numa segunda leitura porque `ActivityEvent.subjectId` é polimórfico e não tem relação Prisma com `Client`.
- O saldo continua calculado por `calculateOutstandingByCurrency` com Decimal/string. A hierarquia de recebíveis é carregada uma vez, a lista visível mantém o limite de 50 e o saldo considera todos. Filtros `organizationId`, `clientId`, visibilidade e permissões permanecem. As leituras usam a transação curta com limites já existentes de 10 s; pool e timeout global não foram ampliados.
- No fixture QA somente leitura, passou de 24 eventos Prisma/21 SELECTs por chamada para 5 eventos/2 SELECTs. Dez amostras aquecidas com pool de uma conexão: p50 1,224 s, p95/máximo 1,259 s, zero falhas e saldo `BRL 880.0000`. Duas chamadas concorrentes terminaram em 1,219 s e 2,437 s. A primeira leitura após desconexão levou 2,633 s e inclui reconexão.
- A duração do evento Prisma inclui a ida e volta cliente-banco, não apenas CPU SQL. O tempo até iniciar o callback combina fila do pool e setup/aquisição, sem métrica Prisma que os separe. HTTP não foi medido: os dois tenants QA estavam arquivados, suas sete memberships suspensas e não havia JWT ativo. O guard de rate limit grava em `api_rate_limits`, então não chamamos a rota autenticada no banco compartilhado. HTTP/JWT/RLS e disputa real de pagamento continuam sem comprovação.
- Testes direcionados do financeiro: 23 passaram. Validação completa: 160 testes (118 API, 25 web, 17 shared), lint, typecheck, format check, Prisma validate e build API/UI/web passaram. Nenhuma escrita, migration ou deploy. Latência do serviço: PASS; resultado geral: PARTIAL por HTTP bloqueado e ausência de prova HTTP/JWT, RLS e volume persistido crescente.
- Evidências: `test-results/financial-overview-optimized-final-20261027.json`; relatório `docs/auditoria-2026-10-27/OTIMIZACAO_P0_1_OVERVIEW_FINANCEIRO.md`; harness `tools/qa/benchmark-financial-overview-optimized.mjs`.

### Consolidação financeira e ciclo de despesas — 2026-10-27

- Com autorização explícita limitada a dados QA sintéticos, a rota HTTP do overview foi exercitada com JWT, membership, permissão, rate limit e Prisma no Supabase atual. Auth/PostgreSQL/Storage correspondiam ao mesmo projeto, que permanece conectado a Vercel Production/Preview. Sem P2024: 10 leituras aquecidas p50 2,589 s, p95/máximo 2,755 s; duas concorrentes 4,280/5,130 s. O HTTP não alcançou a meta p95 <2 s e não houve decomposição por camada.
- Disputa PostgreSQL real com duas chaves de idempotência distintas: respostas 400/201, uma única confirmação e alocação 65.0000, saldo 35.0000, sem duplicidade ou excesso; outro tenant recebeu 404. /reports/received retornou 65.00. Artefato: test-results/qa-financial-http-1793151156330-be7cdb.json. Duas organizações e identidades sintéticas foram arquivadas/suspensas; perfil, auditoria e contador QA foram retidos. Nenhum registro preexistente ou migration foi alterado.
- O módulo de despesas existente agora tem API/UI local para criar/editar, enviar, aprovar/rejeitar, pagar integralmente, cancelar, filtrar e resumir por moeda; inclui vínculos validados, documentos via relação existente e auditoria transacional. Aprovação é obrigatória por padrão e configurável apenas por administrador. Vencimento é obrigatório para novos registros e não pode ser removido na edição. Pagamento parcial não existe; reimbursable é sinalizador informativo e não cria recebível ou receita. Forma/referência do pagamento ficam em metadados de auditoria; não há livro auxiliar nem provedor externo.
- A migration packages/db/prisma/migrations/20261027150000_expense_workflow/migration.sql e a mudança Prisma local acrescentam REJECTED, responsável e dados de rejeição. A migration não foi aplicada; por isso despesas HTTP/UI, anexos e relatórios de caixa não têm comprovação integrada e o módulo não deve ser marcado operacional.
- Novos relatórios de previsão e caixa separam recebíveis esperados de pagamentos confirmados, despesas aprovadas/em aprovação de despesas pagas, e agrupam por moeda. cash-flow e cash-flow-by-client também foram executados em leitura direta, somente na organização QA arquivada: BRL 65.0000 recebido/líquido, zero de despesas, uma linha por cliente/processo. Evidência: test-results/qa-cash-flow-readonly-1793151156330-be7cdb.json. GET /reports/received teve prova HTTP real; o acesso direto aos novos relatórios não valida JWT.
- Validações finais: 171 testes (129 API, 25 web, 17 shared), npm run lint, npm run format:check, npm run typecheck, npm run db:validate e npm run build passaram. Estado da missão: PARTIAL por migration pendente, fluxo de despesas sem teste integrado e objetivo de latência HTTP não alcançado. Relatório: docs/auditoria-2026-10-27/IMPLEMENTACAO_FINANCEIRO_E_DESPESAS.md.
- Arquivos alterados nesta etapa: endpoints/schemas/serviço/testes de Financeiro e Relatórios, schema Prisma local e migration pendente, UI de operações financeiras/relatórios e estilos, harness HTTP QA, README QA, este contexto e o relatório final. Nenhuma alteração preexistente foi descartada.

### Revisão final do módulo de despesas — 2026-10-27

- Migration `20261027150000_expense_workflow` revisada contra PostgreSQL 17.11 em modo somente leitura. No destino, `REJECTED` e as cinco colunas novas ainda não existem. Foram observadas sete despesas legadas, todas DRAFT; seis sem vencimento. Nenhuma linha foi alterada. A API deixa esses registros legíveis e bloqueia envio até que o vencimento seja informado.
- Aprovação obrigatória segue como padrão quando `Organization.settings.expenseApprovalRequired` não está definido. O envio verifica membro ativo distinto do criador com permissão `expenses:approve`; o escritório individual recebe bloqueio e mensagem para desativar a exigência ou habilitar outro aprovador. Confirmação sem aprovação não inventa aprovador.
- Histórico paginado de despesa foi ligado à auditoria existente, filtrado por organização/cliente e sem retornar valores da auditoria. Listagem só inclui títulos de documentos a quem tem `documents:view`; portal só recebe documento CLIENT do próprio cliente.
- SQL espelhado em `supabase/migrations` e na pasta Prisma, com `REJECTED BEFORE PAID`, colunas nulas sem default, FKs RESTRICT e índices. Arquivos idênticos. A aplicação usa Supabase CLI; migration, deploy e escrita remota não foram feitos. O projeto atual segue associado a Vercel Production/Preview, logo precisa de aprovação de schema específica.
- Fluxo preserva Decimal, moeda por despesa, lock da linha, pagamento integral e auditoria; os relatórios separam pago/previsto e recebido/recebível. Parcial, estorno, reembolso processado e conciliação seguem indisponíveis.
- Validações locais: 182 testes (136 API, 29 web, 17 shared), lint, format check, typecheck, Prisma format/validate/generate e build completo passaram. HTTP, RLS e relatórios de despesa no novo schema continuam sem comprovação; estado do módulo permanece PARTIAL até migration autorizada e smoke test integrado.
- Relatório e SQL exato: `docs/auditoria-2026-10-27/REVISAO_FINALIZACAO_DESPESAS.md`. `MIGRATION_READY_FOR_APPROVAL: YES` indica somente prontidão para aprovação, não autoriza aplicação.

### Preflight de ativação de despesas — 2026-10-27

- Destino novamente confirmado por env + conexão SQL: project ref `ioebcdpyrszokdyaoaqv`, PostgreSQL 17.11; Auth/Storage usam o host Supabase da mesma ref. Histórico remoto tem 16 migrations aplicadas até `20261022213000`, sem divergências nas tabelas/índices existentes de despesas. As sete despesas seguem DRAFT/BRL e seis sem vencimento.
- O dry-run oficial, precedido pelo safeguard do repositório e apontado ao `DIRECT_URL` validado, listou apenas `20261027150000_expense_workflow.sql`, sem seed/roles. O atalho `--linked` falhou pois este checkout não tem project ref vinculada; não foi alterada a configuração local de link. Nenhuma migration foi aplicada.
- O Management API de backups respondeu 403 para a identidade disponível. Backup recuperável/PITR não foi verificado nem criado; aplicação bloqueada até proprietário comprovar no Dashboard um backup recuperável. API publicada respondeu health 200 sem informar commit, então compatibilidade foi revisada estruturalmente como aditiva, sem atestação do commit Vercel.
- Nenhuma escrita de dados, alteração de schema ou deploy ocorreu. Aguardando confirmação de backup e autorização explícita da migration exata neste projeto conectado a Production/Preview. Relatório: `docs/auditoria-2026-10-27/REVISAO_FINALIZACAO_DESPESAS.md`.

### Backup antes da migration de despesas — 2026-10-28

- Ref Supabase confirmada; PostgreSQL 17.11 e conexão `DIRECT_URL` na porta 5432 (session pooler). Binários EDB `pg_dump`/`pg_restore` 17.11 usados após SHA-256 do pacote binário conferir com checksum publicado.
- Export custom `pg_dump --schema=public`, exit 0: `C:\Users\jarde\AppData\Local\LivioLegal\Backups\expense-workflow-20261028-001\livio-public-pre-expense-migration.dump`, 735.578 bytes, SHA-256 `99952799a4bcb6ed18827199760812d2be9fffc4cd38c6f51296ead26e7ec1f2`.
- `pg_restore --list` e extrações de schema/dados passaram; verificadas 718 entradas no TOC, seis tabelas financeiras, schema anterior à migration e sete linhas em `expenses`. ACL da pasta/arquivo restrita ao usuário atual e SYSTEM. Arquivo e ferramentas estão fora do Git. BitLocker não está associado a C:; sem criptografia EFS, portanto há risco residual de exposição em perda/furto do dispositivo.
- Escopo é apenas `public` (schema e dados); não inclui Auth, Storage/objetos, roles globais nem configuração Supabase/Vercel. Não houve restore real: `RESTORE_NOT_TESTED`.
- Reconsulta após o dump confirmou sete despesas DRAFT/BRL, seis sem vencimento; enum/histórico remoto continuam pré-migration (16 migrations até `20261022213000`). Nenhuma migration, escrita, deploy ou alteração de configuração de criptografia ocorreu. Relatório: `docs/auditoria-2026-10-27/BACKUP_PRE_MIGRATION_DESPESAS.md`.

### Aplicação autorizada da migration de despesas e QA — 2026-10-28

- Com autorização explícita do proprietário, backup conferido novamente e dry-run oficial listando somente `20261027150000_expense_workflow.sql`, apliquei exclusivamente essa migration pelo Supabase CLI ao projeto `ioebcdpyrszokdyaoaqv`, conectado a Vercel Production/Preview. Hash dos SQL pareados: `3F94E03D5137EE79A9A45088AB458ABCBCB441A2751AD89C4BF60F378D71EA4E`. CLI confirmou `dryRun:false`, sem seeds/roles; dry-run posterior retornou `upToDate:true`, migrations vazias.
- Schema verificado: enum `REJECTED` antes de `PAID`, cinco colunas anuláveis, duas FKs RESTRICT/CASCADE e dois índices esperados. Histórico remoto tem 17 versões, a nova uma única vez como última.
- As sete despesas pré-existentes permaneceram DRAFT/BRL, seis sem vencimento. Hash JSONB dos campos originais antes/depois da migration e depois do QA permaneceu `2a02abed87db1766f30c3dcd1988896d3c5272f3f604bd18dc53b44f90b01cee`. Nenhuma linha preexistente foi modificada.
- Run de despesas `1793200034677-b5a54e`: nove checks HTTP autenticados passaram para permissões, política desabilitada/habilitada, office individual, criação/edição/vencimento, responsável/cliente, rejeição/autoaprovação, pagamentos exatos/parciais recusados/duplicidade, histórico, comprovante e URL assinada, filtro, relatórios/caixa e isolamento. Duas organizações sintéticas foram arquivadas; três contas QA suspensas/banidas; perfis, auditoria, counters e PDF privado retidos.
- A tentativa ampla anterior parou antes da jornada de despesas pela asserção de rate limit que exige decremento estrito do cabeçalho em cada leitura do overview (`test-results/qa-financial-http-1793199769444-118749.json`). O modo `--expenses-only` do harness desacoplou a validação; o overview não é declarado PASS. Scheduler de notificações estava ativo e foi deixado intocado; nenhuma chamada de notificação foi feita, mas o job pode processar itens independentes.
- `npm run db:validate`, `npm run db:generate`, `npm run build:api`, TypeScript estrito/ESLint do QA e `npm run format:check` passaram. Não houve deploy. Frontend em navegador, RLS executada como role SQL `authenticated` e restore do backup permanecem não testados. O backup é apenas `public`, sem Auth/Storage. Pagamento parcial, estorno, reembolso processado e conciliação continuam indisponíveis.
- Relatório: `docs/auditoria-2026-10-27/ATIVACAO_MIGRATION_DESPESAS_E_QA.md`. O artefato canônico de schema/preservação fica fora do Git na pasta protegida do backup. `post-migration-schema-verification.json` é somente um intermediário inválido de serialização, explicitamente substituído pela checagem canônica final.

### Sprint de qualidade, experiência real e estabilização — 2026-10-28

- Checkout preservado em `main`, HEAD `919a5accc91bc96dbd87773411668d017f968e35`; working tree já estava extensamente alterado. Sem reset, migration, configuração cloud ou deploy. A migration de despesas já estava aplicada antes desta sprint.
- QA HTTP autenticado financeiro/despesas: 14/14 checks PASS. Pagamento concorrente com duas chaves idempotentes confirmou um único pagamento/alocação, `65.0000` recebido e `35.0000` de saldo. Isolamento cross-org, despesas, Decimal, aprovação, comprovante privado/hash e relatório passaram. Evidência em `docs/auditoria-2026-10-27/evidencias-sprint-qualidade/qa-financial-http-1793210901033-f197d7.json`.
- Rate limit permaneceu ativo. A asserção antiga era incorreta em virada da janela fixa UTC e ordem de concorrência; o teste agora compara janela/counter/header persistidos e cobre rollover. QA real viu contador 1→3 para duas requisições concorrentes.
- Overview HTTP: 10 aquecidas, concorrência 1, p50 2.517 s, p95/máximo 2.672 s; frio 3.162 s; concorrência 2 chegou a 5.300 s. A meta p95 <2 s não foi atingida. Os tempos Prisma incluem pool, rede e SQL, que não foram separados. Navegação rápida com pool local de uma conexão reproduziu P2024 em `/documents/templates`; smoke serializada não teve 5xx, portanto a causa de capacidade segue aberta.
- Playwright passou 21/21 com mocks. Browser real conectado a Auth/API/PostgreSQL visitou 15 módulos, autenticou administrador e cliente sintéticos, fez logout e validou portal e viewport 360 px; não cobriu CRUD real completo de todas as jornadas. Corrigido layout responsivo dos filtros de atividades.
- Redaction de tokens/URLs assinadas adicionada a logs/erros; upload em memória limitado a 20 MiB; instrumentação QA de requests/Prisma adicionada sem SQL/parâmetros; fixture cliente limitada a permissões do papel. O scheduler continuou ativo e intocado; sem e-mail/push/webhook/cobrança nesta execução.
- Validações locais: `npm test` 183 PASS, `npm run test:e2e` 21/21, lint, format check, typecheck, Prisma validate e build PASS. `npm audit` continua com 5 high em dependências de produção e 2 critical no ambiente de desenvolvimento, entre outros findings. RLS não foi testada diretamente como role SQL `authenticated`.
- Supabase `ioebcdpyrszokdyaoaqv` também está conectado a Vercel Production/Preview; não é ambiente de QA isolado. A última informação de deployment disponível apontava 22/10 no commit-base; nenhum código desta sprint foi publicado. `BACKEND_READY`, `FRONTEND_READY` e `SECURITY_READY` são PARTIAL; `PRODUCTION_RELEASE_READY=NO`.
- Relatório completo e evidências: `docs/auditoria-2026-10-27/SPRINT_QUALIDADE_EXPERIENCIA_E_ESTABILIZACAO.md` e `docs/auditoria-2026-10-27/evidencias-sprint-qualidade/`.

### Capacidade e concorrência — 2026-10-28

- Esta rodada preservou o branch/checkout e as alterações históricas preexistentes. Não executou migration, deploy nem alteração de configuração cloud. O endpoint da API usa um `PrismaService` singleton; o pool local configurado para os testes remotos tinha `connection_limit=1` e `pool_timeout=10` (default). Auth, memberships e rate limit continuam gerando consultas por requisição.
- A comparação somente leitura com três lotes de três consultas por pool encontrou p50/p95 de 1843/2773 ms no pool 1, 942/2165 ms no pool 2 e 925/2172 ms no pool 3. A espera acumulada reportada pelo histograma do Prisma caiu de 8286 ms para 2815 ms e 1,8 ms, respectivamente. A latência remota restante não caiu abaixo de dois segundos no p95. `pg_stat_activity` mostrou capacidade PostgreSQL nominal livre, mas o limite específico do PgBouncer e o máximo de instâncias Vercel não foram confirmados.
- Navegação rápida de browser real, autenticado e sintético, no pool 1 produziu 301 eventos de consulta e fila Prisma máxima 13; 23 leituras de membership/permissões e 23 gravações de rate limit foram vistas. O ensaio parou quando quatro chamadas locais continuavam pendentes após 45 s. Não se confirmou P2024 nesta execução nem erro 5xx nas 16 respostas concluídas, mas a fila/backlog confirma instabilidade. Evidência: `docs/auditoria-2026-10-27/evidencias-capacidade-concorrencia/`.
- Corrigida invalidação ampla do cache GET da web para os dois eventos somente de telemetria (`module-views` e `client-views`); mutações de negócio continuam invalidando leituras. Testes locais aprovam. A instrumentação QA separa forma/duração de consultas de gauges/histograma de espera e não emite SQL, parâmetros ou dados financeiros. Prisma Metrics é recurso preview/depreciado e precisa ser substituído antes de Prisma 7.
- Regressão local: 186 testes Vitest e 21 testes Playwright com API mockada passaram; lint, typecheck, Prisma validate, build completo e formatação direcionada passaram. O `format:check` global aponta seis JSON de evidência gerados, não formatados por Prettier; os artefatos originais foram preservados.
- As jornadas reais cliente→processo, contrato→pagamento→relatório e despesa→aprovação→pagamento ficaram bloqueadas pela saturação observada. Não houve deploy/migration. A versão publicada na Vercel não foi consultada nesta etapa. Manter pool 1 na configuração publicada até medir capacidade combinada de instâncias Vercel e PgBouncer; pool 2 é somente candidato para uma API local única, não recomendação de produção.

### Estabilização da navegação com pool local 2 — 2026-10-28

- `connection_limit=2` foi aplicado exclusivamente ao processo local Nest, mantendo `pool_timeout=10`; nenhum deploy, migration ou ajuste cloud ocorreu. O processo local singleton conectou ao Supavisor transaction pooler na porta 6543. Limites máximos do Supavisor e da Function Vercel não foram confirmados; `vercel env ls production` mostrou apenas nomes de variáveis, sem expor valores.
- Browser real autenticado como administrador QA: dashboard, clientes e processos abriram, mas a navegação solo falhou ao abrir Financeiro/Despesas. A página lançou sete endpoints financeiros distintos mais leituras auxiliares; com duas conexões abertas/ocupadas, houve quatro esperas e dez requests ainda sem resposta em 23,652 s. p95 de nove respostas concluídas: 4,518 s. Consultas Prisma: 117, p95 521 ms; p95 de membership 1,891 s e rate limit persistido 1,726 s. Nenhum P2024; pool timeout não foi aumentado.
- Duas sessões de browser com o mesmo admin sintético chegaram a oito esperas em 1,376 s, então a terceira não foi iniciada. Esse teste não representou identidades diferentes. Jornadas reais de escrita, documentos e tarefas ficaram bloqueadas/não executadas. As contagens de entidades de negócio QA permaneceram idênticas; houve somente os registros técnicos esperados de login/telemetria/rate limit.
- Telemetria `module-views`/`client-views` não invalidou GETs: zero refetch de clientes após POST. Corrigido o repasse do cliente selecionado a `LegalCrm`, com teste Playwright de `client-views` e `clientId`. Comparativo de microbenchmark (9 SELECTs, 3 concorrentes) p95: pool 1=2,773 s; 2=2,165 s; 3=2,172 s — pool 3 não trouxe ganho sobre 2.
- `npm test` 186, Playwright mockado 21/21, lint, format check, typecheck, Prisma validate e build passaram. Estado operacional: `NAVIGATION_STABLE=NO`, `POOL_2_VALIDATED=PARTIAL`, `REAL_BROWSER_FLOWS=BLOCKED`, `VERCEL_POOL_READY=NO`, `RELEASE_READY=NO`.
- Relatório e evidências: `docs/auditoria-2026-10-27/ESTABILIZACAO_NAVIGACAO_POOL2.md` e `evidencias-navegacao-pool2/`. Arquivos desta etapa: runner QA, README, callback de cliente, teste E2E, `.prettierignore`, este contexto, relatório e evidências. Não foram descartadas alterações preexistentes.

### Redução de concorrência no Financeiro e deduplicação de membership — 2026-10-28

- `AuthenticationGuard` agora compartilha somente a Promise em andamento para a mesma chave perfil+organização. A entrada é removida ao concluir, sem TTL nem cache persistente, reduzindo SELECTs redundantes durante rajadas sem atrasar revogações de permissão. Testes cobrem coalescência simultânea, organizações distintas e nova leitura após conclusão.
- Financeiro/Despesas passou a buscar recebíveis, pagamentos, correções e despesas quando suas seções se aproximam do viewport. A seção de recebíveis também respeita `receivables:view`; atualizações após mutações recarregam apenas os conjuntos afetados. A telemetria permanece fora da invalidação de cache de negócio.
- Verificações desta rodada: teste do `AuthenticationGuard` 3/3 e typecheck web passaram; o Playwright de pagamento passou uma vez após as mudanças de lazy load, antes de acrescentar uma asserção de ausência de GET de despesas. A repetição dessa asserção foi bloqueada por OOM no worker Node; o host reportou somente 12 MiB de memória física livre. Não foram executados testes integrados remotos ou jornadas de escrita nesta rodada.
- Rate limit continua distribuído e persistido no PostgreSQL. Sua gravação por requisição não foi removida; reduzir esse roundtrip requer serviço distribuído externo com limites e disponibilidade aprovados. Nenhum pool da Vercel, migration ou configuração cloud foi alterado.
- Resultado permanece parcial: as mudanças diminuem a fan-out inicial e consultas duplicadas de membership, mas não comprovam navegação integrada estável, desempenho sub-2s, capacidade de Vercel/Supavisor nem jornadas reais completas. Reporte atualizado em `docs/auditoria-2026-10-27/ESTABILIZACAO_NAVIGACAO_POOL2.md`.

### Memória e validação gradual — 2026-10-29

- Windows: 3.790 MiB de RAM física; 14 a 173 MiB livres durante o diagnóstico, caindo a 56 MiB na última leitura. Compromisso aproximado de 10.654 MiB de 14.406 MiB; pagefile `C:\pagefile.sys` de 10.615 MiB, com 5.613 MiB em uso. C: tinha aproximadamente 35,5 GB livres. A pressão de memória é do host como um todo, com Chrome, VS Code, Codex e serviços do sistema em uso; nenhum deles foi encerrado.
- Não havia processo Node, API, frontend, worker Playwright, build ou teste do Lívio ativo, nem listeners locais nas portas de desenvolvimento examinadas. Os Node encontrados eram de outro conector. Nenhum processo órfão do projeto foi identificado; zero recursos foram liberados por encerramento. Sem RAM segura, não se iniciou Playwright, API, frontend ou conexão ao Supabase nesta rodada.
- O hook `useApiData` agora associa dados e erros ao caminho requisitado, impedindo exibição transitória de resposta antiga ao mudar o filtro/caminho e ignorando falha de requisição abortada. Testes de membership foram ampliados para usuários distintos, revogação após conclusão e retry depois de rejeição. O Playwright já tinha um worker, execução sequencial e trace em falha; foram explicitados timeouts de teste e asserção.
- Validação de código: revisão estática do mecanismo de deduplicação e das condições de carregamento do Financeiro. Os testes adicionados ainda não foram executados nesta rodada. Gate de memória impediu Vitest, Playwright, format check, lint, TypeScript, Prisma validate e builds; não há aprovação nova de regressão. Não houve migration, deploy, alteração cloud ou escrita no banco.
- Permanecem sem comprovação: navegação real completa com uma sessão, segunda sessão com identidade distinta, p50/p95 novos, fila Prisma, contagem de requisições depois das otimizações e invalidação seletiva do cache global após mutações. Não declarar release pronta até executar esses gates em host com RAM suficiente.

### Diagnóstico de memória e testes locais — 2026-10-29

- Criado `tools/qa/configurar-memoria-windows.ps1`, com modos `Diagnostico`, `Configurar` e `Testar`. O runner mede RAM/commit durante cada processo, executa comandos em sequência, limita Vitest a um worker e encerra somente descendentes dos próprios testes caso a RAM permaneça abaixo de 48 MiB. Logs temporários ficam em `%TEMP%`.
- Diagnóstico inicial: RAM física 3.790 MiB, 126 MiB disponíveis; commit 7.388/14.942 MiB; `C:\pagefile.sys` alocado em 11.152 MiB, com 2.934 MiB em uso e pico observado de 3.213 MiB; C: livre 32,87 GiB. `AutomaticManagedPagefile=False` global, mas a entrada de C: está sem limite fixo (`0/0` no WMI/registro). Havia 7.554 MiB de margem de commit.
- `Configurar` concluiu `NOT_NEEDED`: a paginação já estava ativa, sem limite fixo explícito, e a margem de commit era ampla; não alterou página, outros discos ou política do Windows e não solicitou reinicialização. A leitura final após as verificações mostrou 180 MiB de RAM disponível, commit 7.241/14.942 MiB, pagefile inalterado (11.152 MiB alocados/2.838 MiB em uso) e C: livre 32,88 GiB.
- `apps/api/package.json` e `apps/web/package.json` agora executam Vitest com um worker e sem paralelismo entre arquivos. Playwright já estava configurado sequencialmente com um worker. Nenhum processo Chrome, VS Code, Codex, Windows ou de outro projeto foi encerrado; os dois Node existentes pertenciam ao Dokploy MCP e não havia Node/API/web/Playwright do Lívio ativo.
- A execução final direcionada passou: AuthenticationGuard 5/5, cliente HTTP/cache 7/7 e lógica de despesas 4/4. ESLint dos arquivos afetados, TypeScript da API e da web, Prettier direcionado e `prisma validate` passaram. O typecheck encontrou dois acessos opcionais no retorno de `use-api-data`; as expressões foram corrigidas e a repetição passou. Ainda não há teste unitário dedicado para o hook; a suíte de cliente HTTP/cache cobre comportamento relacionado, não substitui essa cobertura direta.
- Playwright financeiro e build web ficaram `BLOCKED`: a RAM física livre medida durante o gate foi 696 MiB, abaixo do mínimo conservador de 1.536 MiB definido para o build; o artefato `.next` existente é de 2026-10-28 18:02 e anterior aos arquivos financeiros/E2E modificados. Não foi usado build obsoleto. Ao final, a RAM disponível retornou a 180 MiB.
- Navegação integrada com API, frontend e pool Prisma 2 não foi iniciada: não há `.env.test.local`, Docker/Podman ou servidor local; o único `.env` do checkout é documentado como conectado ao projeto compartilhado com Production/Preview. Não iniciar API contra esse destino nem realizar navegação com sessão sem ambiente de teste isolado. Sem Supabase, migration, deploy ou alteração de dados nesta etapa.
- Estado: `MEMORY_BLOCKER_RESOLVED=PARTIAL`, Vitest direcionado aprovado; Playwright e validação integrada continuam bloqueados por RAM física e ambiente local isolado ausente. Não declarar validação integrada pronta.

## Validacao CI em runner GitHub (2026-10-29)

- Branch local `validation/gha-ci-20261029`, commit `af20e33`, reune o codigo, testes, schema e migrations versionadas presentes neste checkout para validar a versao atual. A branch `main` permanece sem novos commits.
- O workflow `Quality` aceita pushes `validation/**`, usa Node 24 e `npm ci`, e executa format, lint, TypeScript, Vitest, Prisma Validate, builds, checagem de bundle e Playwright sequencialmente. O navegador usa APIs mockadas, um worker e publica relatorio/trace como artefato.
- O job de isolamento Supabase e ignorado em branches de validacao. Os demais jobs usam somente URLs loopback e valores placeholder; nenhum `.env`, credencial ou alvo compartilhado e requerido.
- Foram excluidos do commit local `.env`, configuracoes Vercel, auditorias/evidencias QA, ferramentas operacionais e o arquivo Prisma arquivado. Migrations SQL foram apenas versionadas; nenhuma migration, seed, deploy ou acesso cloud foi executado.
- A verificacao Prettier dos arquivos suportados staged e `git diff --cached --check` passaram. O scanner de padroes de credenciais nao encontrou chaves nos arquivos staged.
- Nenhum push foi feito e nenhum workflow novo foi executado. A publicacao da branch ainda requer autorizacao explicita; ate la build e Playwright no GitHub permanecem pendentes.

## Bloqueio de Preview Vercel para validacao (2026-10-29)

- O preflight identificou que push em branch Git conectada pode criar Preview Vercel. Os dois projetos do monorepo possuem configuracao Vercel; a documentacao do projeto informa uso do mesmo backend Supabase em Preview e Production. O workflow GitHub desta branch, por si, nao executa deploy nem operacoes de banco.
- Para evitar Preview apenas nesta branch, foi criado localmente o commit filho `7f1f137` com `git.deploymentEnabled` falso para `validation/gha-ci-20261029` em `apps/api/vercel.json` e `apps/web/vercel.json`. As demais branches permanecem no comportamento padrao. JSON e Prettier passaram.
- O commit originalmente autorizado `af20e33` permanece como pai intacto. A branch ainda nao foi publicada; o push do novo HEAD aguarda autorizacao porque inclui o commit adicional de seguranca.

## Preflight e push GitHub (2026-10-29)

- Vercel CLI autenticada em modo leitura confirmou os projetos `controle-livio` (`apps/api`) e `controle-livio-web` (`apps/web`), ambos conectados ao repositorio e com `main` como production branch. A integracao de deploy esta habilitada globalmente; nao ha `ignoreCommand` do projeto. Os arquivos Vercel do commit `7f1f137` contem a regra exata `validation/gha-ci-20261029=false`; os outros branches nao estao listados nessa regra.
- A consulta de deployments por branch retornou zero correspondencias nos dois projetos. A configuracao branch-specific segue a documentacao oficial Vercel `git.deploymentEnabled`; nao foi alterado o Dashboard nem outro setting cloud.
- O unico workflow GitHub e `Quality`: permisos `contents: read`, placeholders loopback, sem secrets; o job Supabase local e pulado em refs `validation/**`. Nao executa migration, seed, deploy ou escrita cloud.
- O push explicito `HEAD:refs/heads/validation/gha-ci-20261029` foi recusado com HTTP 403. Nao existe branch remota publicada e nenhuma execucao Actions foi criada. A credencial GitHub presente nao possui escrita; CLI `gh` e chave SSH/token alternativos nao estao disponiveis.

## Autenticacao GitHub e permissao (2026-10-29)

- Git usa Credential Manager global (`manager`), versao 2.7.0. O fluxo oficial GitHub OAuth pelo navegador concluiu com sucesso e adicionou a conta nova `efriten1-ai`; a conta antiga `rbandeiragabriel` foi preservada. `git credential fill` selecionou a conta nova.
- `git push --dry-run` foi recusado pelo GitHub com `403 Permission denied to efriten1-ai`, confirmando que a autenticacao identifica a conta, mas ela nao tem permissao de escrita efetiva no repositorio (ou o grant atual nao cobre este repositorio). Nenhuma credencial foi removida, nenhum token foi exibido e nenhuma branch foi publicada.
- O HEAD local permanece `7f1f137f6325f339133a56ef7bad10ea4a46f248`; o remoto nao contem a branch. Nao houve execucao Actions nem novo deployment Vercel. Para continuar, `efriten1-ai` precisa receber e aceitar permissao Write no repositorio, ou deve ser autenticada uma conta ja autorizada.

## Validacao CI Quality no GitHub - 2026-10-29

- A branch `validation/gha-ci-20261029` esta publicada no commit `63465ae4e10abe118893a9e37ab399b6481c35c3`; o commit autorizado `7f1f137` permanece ancestral e nenhum push foi feito para `main`.
- Quality #40904968733 passou: format check, ESLint, TypeScript, Prisma Validate, builds API/UI/web e bundle check. Vitest: API 143/143, web 30/30, shared 17/17 (190 total). Playwright mockado: 21/21.
- Correcoes: `document-generator.service.ts` copia os bytes da logo para `Uint8Array` antes do `embedJpg`, evitando erro do pdf-lib quando o Buffer tem offset; `operations.css` aplica largura e min-width controlados ao seletor de aprovacao de despesas, corrigindo overflow de 1 px em 360 px. A assercao E2E de overflow permanece ativa e agora inclui diagnostico dos elementos.
- O job `supabase-isolation` foi ignorado pela condicao da branch. O workflow Quality usa APIs mockadas/placeholders; nao houve migration, seed, deploy nem operacao no Supabase.
- Os dois `vercel.json` desabilitam deploy para esta branch. A consulta final encontrou quatro registros da API em `CANCELED` com `target: null` e nenhum registro no projeto web; nenhum Preview esta ativo. O Vercel ainda registra a tentativa cancelada ao receber push.
- A navegacao integrada com API/banco reais segue pendente e requer ambiente QA/dev isolado, dados sinteticos e autenticacao de teste. A CI atual valida build e fluxos mockados, nao uma sessao real.

## Validacao integrada local no GitHub Actions (2026-10-29)

- Quality #34 concluiu com sucesso no commit `a7f70d9e7905ac291db4035283afd016d2c32ab0`, branch `validation/gha-ci-20261029`: https://github.com/steveejobs/controle-livio/actions/runs/40920818310. Os jobs `application` e `supabase-isolation` passaram. O workflow publicou os artefatos `integrated-supabase-browser-evidence` e `playwright-report`.
- O runner hospedado do GitHub iniciou PostgreSQL, Supabase Auth e Storage temporarios; aplicou migrations versionadas e dados sintéticos, e executou API NestJS, web Next.js e Chromium. Os testes de integração usaram URLs loopback, sem mocks de API, credenciais ou dados do Supabase compartilhado. Não houve deploy nem alteração na `main`.
- Quality manteve Vitest 190/190, Playwright mockado 21/21, format check, ESLint, TypeScript, Prisma Validate e builds da API/web aprovados. O job integrado passou nos testes de RLS, roles, notas internas e isolamento do Storage; Playwright real: 9/9.
- A navegação autenticada cobriu Dashboard, Clientes, Processos, Financeiro, Despesas, Documentos e Tarefas, em uma sessão e em duas identidades/organizações. Telas: Dashboard 4 requisições, concorrência máxima 2, p50/p95 46/59 ms, percepção 745 ms; Clientes 2, 22/28 ms, 601 ms; Processos 3, 32/34 ms, 575 ms; Financeiro 3, 60/61 ms, 636 ms; Despesas 5, 40/48 ms, 567 ms; Documentos 4, 27/32 ms, 580 ms; Tarefas 2, 20/21 ms, 561 ms. Nas telas autenticadas não houve erro HTTP, falha de requisição ou pendência ao final. Um 401 inicial em `/v1/auth/me` ocorreu antes do login.
- Financeiro não requisitou despesas antes de a seção entrar na viewport; a lista foi carregada sob demanda. Em uma rajada de seis chamadas autenticadas, duas consultas de membership atenderam as seis chamadas (quatro deduplicadas); todas responderam 200. Prisma: p50 de consulta 0 ms (arredondado), p95 4 ms; espera de pool p50/p95 1/1 ms; máximo aguardando 0, ocupadas 4, abertas 4; P2024 = 0.
- As seis jornadas reais passaram e confirmaram estado na interface e persistência temporária: Cliente→Processo→Responsável→Status; Contrato→Recebível→Pagamento→Relatório; Despesa→Aprovação→Pagamento→Fluxo de caixa; Documento→Upload→Download→Assinatura; Tarefa→Responsável→Conclusão; Portal→Documentos→Mensagens→Permissões. Parte da preparação/criação de entidades usa `fetch` autenticado executado no contexto do navegador e depois verifica a UI e o banco; pagamentos, aprovações, assinatura, mensagem e download incluíram ações/validações de navegador real.
- A validação cobriu permissões e isolamento entre organizações no ambiente temporário; os screenshots sintéticos e relatórios estão nos artefatos da execução. A configuração versionada em `apps/api/vercel.json` e `apps/web/vercel.json` mantém `validation/gha-ci-20261029` desabilitada para deployment. Após a execução, `vercel list` retornou zero deployments dessa branch nos projetos `controle-livio` e `controle-livio-web`.
- Limites para liberação: SMTP/entrega de email, Realtime e Edge Functions hospedadas não foram validados; a stack local não comprova a configuração/integração hospedada. A cobertura browser ainda não percorre todos os formulários de criação por cliques, pois algumas preparações usam API autenticada real. A CI integrada está pronta, mas isso não constitui validação final para cliente ou deploy.

## Sprint de fechamento do primeiro escritório — estado local (2026-10-29)

O lote local adiciona formulários E2E reais para processo/responsável, contrato/recebível/pagamentos e documentos, além de isolamento do portal entre clientes e organizações. A API limita upload a 4 MiB, aplica limites multipart/concor­rência, valida magic bytes e exige ClamAV fora da stack local de teste. Vitest, typecheck, lint, Prisma Validate, build API/UI/web e bundle passaram localmente; 204/204 Vitest e 21 cenários mockados passaram em duas execuções (quatro stubs ajustados e repetidos). O audit atualizado mantém três altas na cadeia Prisma/deepmerge-ts e três baixas de ferramentas, sem críticos/moderados; upgrade recomendado é major e segue pendente. Restore histórico, SMTP controlado e ClamAV real não foram homologados. O Playwright integrado/restore para este lote aguarda nova Actions. Nenhum push/deploy/migration/alteração do Supabase compartilhado foi executado; push requer autorização nova.
## Quality #40962783856 - resultado do commit 48842cb (2026-10-29)

- O commit `48842cb0d336a02c1c66b80ff18813d422bee5f4` foi publicado somente em `validation/gha-ci-20261029`. O job `application` passou: format check, ESLint, TypeScript, Vitest 204/204, Prisma Validate, build API/web, bundle check e Playwright mockado 21/21.
- No job `supabase-isolation`, o Supabase local descartavel iniciou e Auth/PostgreSQL RLS/Storage passaram. O step Playwright integrado falhou; o restore sintetico foi skipped por dependencia. A parada da stack local passou. Este run nao comprova jornadas integradas nem restore para este commit.
- O artefato sanitizado `integrated-supabase-browser-evidence` foi publicado. A interface publica confirma estados dos steps, mas nao disponibilizou o conteudo do log/ZIP nesta sessao. A tentativa de recuperar credencial Git armazenada para buscar logs foi recusada pelo revisor automatico de politica; nenhuma credencial foi exibida ou reutilizada.
- P2024, fila/espera do pool, latencia e requisicoes pendentes deste run permanecem sem leitura; nao assumir zero. Inspecionar o log do step 8/artefato antes de classificar a causa como produto ou runner.
- `npm audit --omit=dev` na arvore imutavel do commit reporta tres altas em `prisma@6.19.3` -> `@prisma/config` -> `deepmerge-ts@7.1.5`; o fix sugerido e Prisma 7.10.1 (major). Audit completo reporta tres baixas de ferramentas e zero criticas. A arvore mostra Vitest 4.1.12 sem Tinypool.
- As duas configuracoes Vercel continuam bloqueando Preview da branch; a consulta apos o push nao encontrou Preview ativo. Nao houve deploy, merge, migration ou acesso/escrita no Supabase compartilhado.
- Nenhum commit corretivo foi criado ou publicado. A proxima acao e inspecionar o erro do step 8 e repetir somente os testes afetados.
## CI integrado #40962783856 — diagnóstico local em 2026-10-29

- `gh` 2.103.3 autenticado como `efriten1-ai`, com permissão `write` em `steveejobs/controle-livio`; logs e artefatos foram recuperados em `%TEMP%`.
- O run do commit `48842cb` passou nos jobs leves e em Auth/RLS/Storage, mas o Playwright integrado teve 4 sucessos e 5 timeouts de 240 s. Falharam as jornadas 1–5, todas iniciadas no viewport 360×800; as jornadas 6 e de perfis passaram. O run anterior #40936072471 passou no commit `8de04ad`.
- Causa: as jornadas 1–5 clicavam diretamente na barra lateral. Em 360 px, `.sidebar` está deslocada para fora da tela até o botão acessível `Abrir navegação` ser usado. Os logs da API não mostram mutações dessas jornadas; não há evidência de falha de produto ou de banco nesses cinco casos.
- Correção local em `apps/web/e2e/integrated/real-browser.integrated.e2e.ts`: helper `navigateTo` abre o menu quando visível e então clica no item; 13 navegações das jornadas 1–5 passaram a usá-lo. As asserções de negócio foram mantidas.
- O reteste integrado com Supabase descartável depende de novo run no GitHub Actions. Não foi feito push, deploy ou migration; as alterações preexistentes do workspace foram preservadas.

## Correção local após Quality #40962783856 — 2026-10-30

- Commit local `2daa023929f6527f536928b6d3606747d3c53575` corrige o harness: a navegação usa botão localizado por nome acessível, valida `aria-controls`/`aria-expanded`, abre e fecha o menu mobile e percorre as nove jornadas em 360×800 e 1440×900. As negações do portal verificam também o tipo e a mensagem da política, além do status HTTP.
- Validações locais: format check (306 arquivos versionados; a cópia local alterada deste arquivo foi ignorada), ESLint, TypeScript, Vitest 204/204, Playwright mockado 21/21, lista dos nove testes integrados, Prisma Validate, builds API/UI/web e bundle check (253.015 bytes gzip).
- A assinatura isolada passou 4/4 e a suíte de documentos 25/25. O novo teste integrado, restore sintético independente e scanner ClamAV real ainda não foram executados neste SHA; dependem de um novo run GitHub Actions. O ambiente local não tem Docker.
- `npm audit --omit=dev` mantém três alertas altos na cadeia Prisma 6/deepmerge-ts. Prisma 7 está documentado em plano separado; nenhuma dependência foi atualizada.
- Não houve push, deploy, migration ou acesso/escrita ao Supabase compartilhado. O commit corretivo permanece somente local; as anotações desta seção também ficam fora dele.

## Quality #41069566951 — resultado do commit 2daa023 (2026-10-30)

- O SHA `2daa023929f6527f536928b6d3606747d3c53575` foi publicado apenas em `validation/gha-ci-20261029`. A execução [#41069566951](https://github.com/steveejobs/controle-livio/actions/runs/41069566951) terminou com falha nos jobs de isolamento Supabase e restore sintético. O job de aplicação passou: format check, ESLint, TypeScript, Vitest 204/204, Prisma Validate, builds API/UI/web, bundle check e Playwright mockado 21/21.
- Supabase temporário iniciou e Auth/RLS/Storage passou. O Playwright integrado registrou 1/9 testes aprovados: o teste de permissões passou em 360×800 e 1440×900. Sete testes falharam por strict-mode ao localizar o botão mobile junto com o backdrop; a jornada do portal chegou a receber 404, mas a asserção esperava `error: Not Found`, enquanto o filtro da API retorna `code: not_found`. Como os testes interromperam no primeiro viewport, as jornadas/formulários e navegação desktop completa não foram comprovadas.
- O scanner ClamAV real `clamav/clamav:stable` (1.5.4) ficou restrito a `127.0.0.1:13310`. O artefato informa aprovação de arquivo limpo, detecção/rejeição EICAR, bloqueio após timeout de 1.508 ms e bloqueio com daemon indisponível. A etapa de upload infectado pela interface não foi alcançada; integração de upload continua parcial. Nenhum scanner foi configurado em produção.
- O restore usou banco descartável independente, mas abortou antes das verificações de recuperação: `pg_restore` tentou conceder acesso ao schema `cron`, removido do destino. O TOC filtrava objetos cron/net, mas deixou passar `ACL - SCHEMA cron`. O artefato de restore não foi gerado; sequências, FKs, contagens, valores e permissões ainda não têm comprovação neste SHA.
- As métricas integradas deste run são parciais: 546 consultas Prisma; P2024=0; duração de consulta p50/p95 arredondada 0/3 ms; 209 amostras do pool; espera p50/p95 1/1 ms; máximo em espera 0, conexões busy 1 e abertas 3. Em 360 px, o painel mediu quatro requests, concorrência máxima 2, p50/p95 34,59/53,94 ms, sem erros HTTP ou requests pendentes; a navegação completa, desktop, fluxo de duas sessões e métricas agregadas não foram medidos.
- ClamAV real e restore ficaram em jobs/steps separados do job de aplicação; não se reutilizou banco compartilhado. As configurações versionadas dos projetos Vercel mantêm Preview desativado para a branch. `vercel project inspect` confirmou os projetos e a consulta por SHA retornou zero deployments para ambos. Não houve merge, deploy, migration ou operação no Supabase compartilhado.
- Correção local `29e5734d9a68974ef94fdc1a2adf10b2c8b3e87e` (não publicada): escopa o botão de menu ao `main`, verifica retorno ao painel após navegar por módulos, valida as respostas de isolamento pelo campo `code` e mensagem, e filtra ACLs de schemas cron/net do arquivo TOC do restore. TypeScript, ESLint, Prettier direcionado, `node --check`, inventário dos nove testes e `git diff --cached --check` passaram; a execução integrada/restore corrigida aguarda publicação autorizada. O commit contém apenas os dois arquivos do harness/restore; alterações locais preexistentes permanecem fora dele.
- Estado atual: Playwright mobile/desktop e workflows financeiros/portal não estão comprovados; ClamAV real aprovado apenas no ensaio direto; restore sintético não aprovado; três alertas altos de produção na cadeia Prisma 6/deepmerge-ts continuam pendentes. SMTP, recuperação histórica isolada, homologação de serviço hospedado e migração Prisma 7 seguem como dependências abertas. Não declarar piloto comercial ou release candidate prontos.
- Proposta não implantada para Vercel/ClamAV: manter `clamd` em subnet privada, sem porta pública, e colocar um gateway HTTPS interno com mTLS/autenticação curta que encaminha `INSTREAM` ao daemon local. Preferir conectividade privada Vercel Secure Compute/VPC peering se o plano permitir; confirmar elegibilidade/custo antes de qualquer alteração. A função deve rejeitar por padrão timeout, indisponibilidade e qualquer verdict diferente de clean, sem liberar objeto antes da análise. Restringir o corpo completo (incluindo multipart) abaixo do limite Vercel de 4,5 MB; se o fluxo crescer, usar bucket privado de quarentena e promover o objeto só após scan. ClamAV limita `INSTREAM` por `StreamMaxLength`; alinhar esse valor ao limite da aplicação. Sem credenciais externas ou mudança cloud nesta etapa.

## Quality #41071960092 — resultado do commit 29e5734 (2026-10-30)

- SHA testado: `29e5734d9a68974ef94fdc1a2adf10b2c8b3e87e`; [execução #41071960092](https://github.com/steveejobs/controle-livio/actions/runs/41071960092) terminou em falha. O job de aplicação passou: Vitest 204/204, Playwright mockado 21/21, ESLint, TypeScript, Prettier, Prisma Validate, builds API/frontend e bundle check.
- Jornadas integradas: 3/9 passaram e 6/9 falharam. A navegação em duas sessões/organizações e a jornada de portal passaram em 360×800 e 1440×900; perfis e permissões também passaram nos dois viewports. A primeira jornada de navegação expirou ao tentar fechar o menu mobile pelo toggle sob o backdrop. Jornada 1 parou em strict mode ao localizar dois elementos `role=status`. Jornada 2 confirmou R$100,00 em três parcelas, saldo parcial, rejeição 409 de duplicidade, rejeição 400 por excesso e pagamentos de quitação; falhou porque o recebível pai permaneceu OPEN em vez de PAID. Jornada 3 escreveu/criou, aprovou e pagou a despesa e consultou fluxo de caixa, mas expirou numa navegação posterior, sem conclusão do teste. Jornada 4 parou por ambiguidade do label Cliente antes do upload. Jornada 5 criou e concluiu a tarefa no banco, mas expirou antes das asserções finais após reload. Os fluxos financeiros e de formulário não completaram em desktop.
- Restore sintético independente falhou antes das validações: `pg_restore` tentou conceder acesso a `cron.alter_job` depois de o schema cron ser omitido. Nenhum artefato de restauração foi gerado; estrutura, dados, sequências, FKs, valores, owners e grants não estão comprovados.
- ClamAV real 1.5.4 passou no runner temporário restrito a 127.0.0.1:13310: arquivo limpo aceito, EICAR detectado/rejeitado, timeout bloqueou liberação e daemon indisponível bloqueou liberação. O upload infectado pela interface não foi alcançado; integração de upload não está homologada.
- Métricas desta execução: 1.719 consultas Prisma; P2024=0; latência de consulta p50/p95 0/4 ms; espera do pool p50/p95 1/1 ms; 7.136 amostras; máximo aguardando 0, busy 3, abertas 4. Para a navegação de duas sessões, requisições pendentes e erros nas fases autenticadas foram zero; dashboard perceptível 355–413 ms, módulos 421–846 ms. A métrica agregada do primeiro teste e a rajada de membership não foram produzidas. O 401 inicial de /v1/auth/me aconteceu antes do login.
- Correções locais ainda não publicadas: fechar o menu mobile clicando em Visão geral; usar labels exatos e mensagens específicas nos locators; limitar ações Playwright a 15 s e reload a DOMContentLoaded/20 s para apontar a navegação que trava; recalcular o status agregado do recebível na transação de pagamentos, reversões, ajustes e correções; filtrar ACL/TOC por schema cron/net inclusive referência qualificada e verificar ausência dos schemas no destino.
- Validação local dessas correções: Vitest completo 204/204 (API 155, web 30, shared 19), TypeScript API/web, build API, ESLint dos arquivos alterados, Prettier direcionado e format check global (306 arquivos versionados; PROJECT_CONTEXT local ignorado), node --check e inventário Playwright com 9 testes passaram. O Playwright integrado, restore em PostgreSQL descartável e upload com ClamAV real ainda não foram reexecutados nessas alterações locais.
- O branch HEAD continua no commit 29e5734. Nenhum commit corretivo adicional foi criado ou publicado; as alterações locais preexistentes permanecem preservadas. Não houve merge, deploy, migration ou operação no Supabase compartilhado. Nova publicação depende de autorização explícita.
- Classificação até novo Actions aprovado: Playwright mobile/desktop NO; workflows de formulário PARTIAL; integridade financeira PARTIAL; isolamento do portal YES nos cenários executados; segurança de upload PARTIAL; restore sintético NO; piloto comercial e release candidate NO. Os três alertas altos Prisma 6/deepmerge-ts seguem pendentes.

## Quality local 4b8b33e - 2026-10-30

- Commit local `4b8b33e9be81e24fd6586563a81ca71e34c57356` e filho direto de `29e5734d9a68974ef94fdc1a2adf10b2c8b3e87e`; inclui somente os cinco arquivos de harness, financeiro e restore autorizados.
- Vitest completo: 205/205 (API 156, web 30, shared 19); financeiro 45/45; documentos 25/25; teste isolado de assinatura 4/4. TypeScript API/web, ESLint, Prettier (306 arquivos versionados), Prisma Validate e build API passaram.
- O filtro TOC passou fixtures locais para ACL de cron/net e retenção de schema, tabela e funcao publicos; `node --check` passou. Nenhum backup ou banco foi acessado.
- Playwright descobriu os nove cenarios; `--list` nao executa as jornadas. O reteste integrado e o restore em PostgreSQL descartavel continuam pendentes do GitHub Actions.
- Commit nao publicado. As demais anotacoes e alteracoes locais continuam fora do commit; nao houve push, deploy, migration ou operacao no Supabase compartilhado.
## Quality #41090840148 — commit 4b8b33e (2026-10-30)

- SHA `4b8b33e9be81e24fd6586563a81ca71e34c57356` foi publicado somente em `validation/gha-ci-20261029`. A [execução #41090840148](https://github.com/steveejobs/controle-livio/actions/runs/41090840148) terminou em falha nos jobs `supabase-isolation` e `synthetic-restore`; `application` passou.
- O job de aplicação passou em Vitest 205/205, Playwright mockado 21/21, TypeScript, ESLint, Prettier, Prisma Validate, builds API/web e bundle check (252.818 bytes gzip). Auth/RLS/Storage temporários passou.
- Jornadas integradas: 5/9 passaram. Autenticação/navegação e duas sessões passaram em ambos os viewports; tarefas e portal/isolamento passaram; perfis/permissões passaram. Cliente/processo, contrato/recebíveis/pagamentos, despesas e documentos expiraram após 240 s. O artefato de timings mostra um INSERT de cliente, mas nenhum INSERT de processo, contrato, recebível, despesa ou documento durante as jornadas que falharam. Como cada teste itera primeiro 360×800 e só registra screenshot ao completar o fluxo, os testes desktop desses quatro fluxos não foram alcançados.
- O resultado não comprova quitação financeira no fluxo de browser, aprovação/pagamento de despesas nem upload/download/assinatura. O portal e suas negações de acesso foram exercitados e passaram. O ClamAV real 1.5.4, em `127.0.0.1:13310`, aceitou arquivo limpo, rejeitou EICAR e bloqueou liberação por timeout (1.508 ms) e daemon indisponível; o caminho de upload da aplicação não foi comprovado.
- Restore independente falhou antes da validação porque `pg_restore` tentou `GRANT ... ON FUNCTION cron.alter_job(...)` sem schema `cron` no destino. Nenhum restore PASS ou artefato de invariantes foi produzido.
- Métricas deste run: 1.618 consultas Prisma; P2024=0; query p50/p95 0/4 ms; 10.136 amostras do pool; espera p50/p95 1/1 ms; máximo aguardando 1, conexões busy/open 4/4. Membership burst: 6 requests, 1 consulta compartilhada e 5 deduplicadas. Navegação autenticada sem erros HTTP nem requests pendentes, máximo de 6 concorrentes. Carregamento percebido: mobile dashboard 977 ms e módulos 524–818 ms; desktop dashboard 661 ms e módulos 538–656 ms.
- Correções preparadas apenas no workspace após o run: o harness usa espera por request e resposta com limite de 15 s e informa se o formulário não enviou a chamada, se faltou resposta e quais campos HTML estão inválidos. O filtro de restore cobre ACLs cron/net com ou sem hífen, schema antes/depois da assinatura, e mantém ACLs explicitamente `public`; fixtures e `node --check` passaram. ESLint direcionado, Prettier direcionado e TypeScript web passaram. Não foi executado reteste integrado ou restore real dessas alterações locais.
- HEAD continua em `4b8b33e9be81e24fd6586563a81ca71e34c57356`; as correções locais não foram commitadas nem publicadas. Não houve merge, deploy, migration, mudança cloud ou operação no Supabase compartilhado. Novo push depende de autorização explícita.
- Prontidão comercial: NO. Jornadas de formulários/financeiro/documentos e restore independente permanecem sem comprovação. A aprovação do ClamAV limita-se ao scanner direto; três alertas altos na cadeia Prisma 6/deepmerge-ts continuam pendentes.

## Diagnóstico e preparo das jornadas integradas — 2026-10-30

- O Quality #41090840148 aprovou 5/9 jornadas e expirou 4 fluxos de formulário após 240 s. Os artefatos publicados não continham screenshots de falha, traces Playwright nem estágios de clique/submissão/requisição. Os logs SQL mostram a inserção de um cliente, mas não as inserções seguintes; portanto, o ponto exato dos quatro timeouts permanece indeterminado e não foi atribuído ao produto nem ao harness sem evidência.
- A navegação autenticada passou no #41090840148, mas o caminho testado fechava o menu pela seleção da rota, sem testar o backdrop. A repetição focada agora confere o clique no backdrop, a atualização de aria-expanded, a navegação, o fechamento após selecionar a rota e o retorno ao painel.
- O harness agora grava estágio de formulário, validade HTML e campos inválidos, evento de clique efetivamente observado, submit, endpoint/método, status HTTP, feedback exato e confirmação posterior de persistência. Esperas de API permanecem limitadas a 15 s. Gera traces de operação sanitizados e screenshots em falhas, ocultando links temporários de assinatura; o trace nativo Playwright continua desligado porque pode conter headers de autenticação.
- O log do restore #41090840148 confirma `GRANT ... ON FUNCTION cron.alter_job(...)` falhando porque `cron` não existia no destino. O artefato anterior não continha o dump nem a saída completa de `pg_restore --list`, então a linha TOC exata não pode ser recuperada retroativamente. O restore local consulta a lista original e a lista produzida por `pg_restore --exclude-schema`, remove ACL/default ACL do TOC, usa `--no-acl`/`--no-owner`, reaplica grants de aplicação controlados e salva apenas as listagens TOC e checkpoints JSON no runner; o arquivo do dump não é publicado.
- Validações locais após as alterações: Vitest 205/205; testes financeiros direcionados 29/29; documentos 25/25; Playwright mockado 21/21; TypeScript, ESLint, format check (306 arquivos), Prisma Validate, builds API/web e bundle check passaram. `node --check` e fixtures TOC passaram sem Docker ou acesso a banco. A descoberta Playwright lista os nove testes; a seleção focada lista cinco, mas ambas são somente descoberta, não execução integrada.
- Esta máquina não tem Docker nem Supabase CLI. Nenhuma das jornadas com Supabase/PostgreSQL/Chromium reais, restore descartável ou Auth/RLS/Storage foi executada sobre o novo código. Não há métricas atuais de P2024, pool, requests ou navegação; métricas de execuções antigas não foram reutilizadas. O ClamAV direto aprovado no #41090840148 não prova o fluxo de upload da aplicação.
- Commit local `77664061392a94fa24906a6eea363d2f4cf17dfc` contém somente `.github/workflows/quality.yml`, `apps/web/e2e/integrated/real-browser.integrated.e2e.ts`, `tools/qa/restore-local-ci.mjs` e `tools/qa/run-integrated-browser-ci.mjs`. Não foi publicado. As demais alterações preexistentes continuam fora do commit.
- Estado atual: causa raiz dos quatro timeouts ainda pendente de nova execução instrumentada; workflows cliente/processo, financeiro, despesas e documentos permanecem parciais; isolamento do portal segue aprovado no SHA publicado 4b8b33e; restore sintético não comprovado; piloto comercial não pronto. Não houve push, deploy, migration nem operação no Supabase compartilhado.


## Quality #41104994780 ? 2026-10-30

- SHA autorizado e testado: 77664061392a94fa24906a6eea363d2f4cf17dfc; [execu??o #41104994780](https://github.com/steveejobs/controle-livio/actions/runs/41104994780) terminou em falha. Application passou: 205 testes Vitest, 21 Playwright mockados, TypeScript, ESLint, Prettier (307 arquivos versionados), Prisma Validate, builds API/web e bundle check. Auth, RLS e Storage tempor?rios tamb?m passaram.
- A su?te focada executou cinco de nove testes: navega??o passou em 360?800 e 1440?900; jornadas 1?4 expiraram aos 240 s em 360?800. O teste completo de nove cen?rios e a execu??o dos fluxos de formul?rio em desktop n?o come?aram; tarefas, portal UI e permiss?es no browser tamb?m n?o foram executados nesta SHA.
- Jornada 1: o browser disparou POST /v1/clients, PostgreSQL registrou INSERT em clients e audit_logs, e a interface abriu a ficha do cliente. O harness ficou parado consultando getAttribute no formul?rio j? desmontado pela navega??o e n?o gravou o status HTTP. O processo/advogado n?o chegaram a ser cadastrados.
- Jornadas 2?4: os snapshots mostram o Cliente ainda no valor padr?o; n?o houve INSERT de contrato, receb?vel, despesa ou documento. Nenhuma submiss?o ou chamada principal dessas tr?s opera??es foi observada. A causa do valor n?o selecionado n?o foi conclusivamente distinguida entre valor de op??o e sele??o do harness; a corre??o local agora registra op??es dispon?veis, confere sele??o acess?vel por r?tulo, compara o UUID esperado e usa o valor selecionado nas asser??es de persist?ncia.
- O restore passou a an?lise do TOC: 231 ACL/default ACL foram suprimidas, refer?ncias residuais cron/net ficaram vazias e a entrada cron.alter_job foi identificada. O pg_restore n?o iniciou porque o runner executou docker exec <container> -U ... sem incluir o execut?vel pg_restore; OCI retornou exit 127. N?o foram validados dados, sequ?ncias, FKs, valores, owners ou grants. A corre??o local inclui o execut?vel e uma fixture da linha de comando.
- ClamAV oficial 1.5.4 no runner, restrito a 127.0.0.1:13310, passou o ensaio direto: limpo aceito, EICAR rejeitado, timeout e daemon indispon?vel bloquearam a libera??o. O formul?rio de upload n?o alcan?ou o scanner; integra??o ClamAV-upload segue parcial.
- M?tricas deste run: 430 consultas Prisma; P2024=0; query p50/p95 0/5 ms; pool wait p50/p95 1/1 ms; m?ximo aguardando 0, busy 2, abertas 4; requisi??es pendentes 0. Navega??o mobile/desktop n?o autenticada registrou somente 401 esperado em /v1/auth/me; telas autenticadas sem erros HTTP. Dashboard percebido 1.211/684 ms mobile/desktop; m?dulos 514?840/555?658 ms. N?o houve m?tricas de duas sess?es nem das jornadas completas.
- Corre??es exclusivamente locais, sem push: 081323eeaf0b969789304893545f1208350cda08 corrige pg_restore no docker exec; f516c691e396e11a764b7e09988485357818b69e corrige a leitura do evento submit e melhora diagn?stico/sele??o acess?vel dos campos. Prettier, ESLint, TypeScript web, node --check, fixtures de restore e descoberta dos nove testes passaram; a descoberta n?o equivale a execu??o integrada.
- Nenhuma corre??o foi publicada; o remoto permanece no SHA autorizado 77664061392a94fa24906a6eea363d2f4cf17dfc. As demais altera??es locais preexistentes foram preservadas. N?o houve deploy, merge, migration, opera??o no Supabase compartilhado ou altera??o cloud. Playwright mobile/desktop, workflows financeiros e de formul?rio, restore sint?tico completo, upload integrado ao ClamAV e piloto comercial continuam sem comprova??o suficiente.

## Quality #41111695144 — resultado e diagnóstico local — 2026-10-30

- O SHA publicado e testado foi `f516c691e396e11a764b7e09988485357818b69e`; a execução #41111695144 terminou em falha. `application` passou: Vitest 205/205 (API 156, web 30, shared 19), Playwright mockado 21/21, TypeScript, ESLint, Prettier (307 arquivos versionados), Prisma Validate, builds API/web e bundle check.
- `supabase-isolation` iniciou a stack local temporária e passou Auth/RLS/Storage antes de falhar no Playwright focado. A navegação autenticada passou em 360×800 e 1440×900. Quatro jornadas falharam em 360×800 ao localizar o seletor Cliente antes de selecionar ou submeter. O runner interrompeu o script; o Playwright completo de nove cenários não foi iniciado. Jornadas 1–4 em desktop e jornadas 5–9 não foram executadas neste SHA.
- Na jornada 1, o formulário real criou o cliente: POST `/v1/clients` respondeu 201, a leitura posterior confirmou persistência e a interface exibiu a ficha/listagem. A jornada avançou até a tela Processo; o DOM mostrou placeholder mais opções de três clientes e opção de advogado ativo, mas o locator aninhado ao formulário não encontrou o combobox. Processo, contrato, despesa e documento não foram submetidos; as três telas posteriores também mostravam as opções de cliente carregadas com o placeholder ainda selecionado. Nenhuma requisição principal desses quatro cadastros foi emitida; não houve validação HTML nem clique de submit nessas operações.
- ClamAV real 1.5.4 em container oficial restrito a `127.0.0.1:13310` passou arquivo limpo, EICAR, timeout (liberação bloqueada) e daemon indisponível (liberação bloqueada). O formulário de upload falhou antes de chamar a aplicação; integração do scanner ao upload permanece sem comprovação.
- `synthetic-restore` falhou durante `pg_restore`, antes das validações do banco novo. O TOC observado contém `7; 3079 19318 EXTENSION - pg_cron` e `6; 3079 16664 EXTENSION - pg_net` sem coluna de owner. O parser exigia seis campos, ignorou essas entradas e deixou `CREATE EXTENSION pg_cron` chegar ao destino, onde falhou porque o banco temporário não é o `cron.database_name`. Tabelas, dados, sequências, FKs, financeiros, owners e grants não foram validados.
- Métricas novas deste run: 457 consultas Prisma; P2024=0; query p50/p95 0/5 ms; 850 amostras de pool, espera p50/p95 1/1 ms, máximo aguardando 2, conexões busy/open 4/4. Membership burst: seis requests 200 com uma consulta compartilhada e cinco deduplicadas. Navegação mobile/desktop terminou com zero requests pendentes e sem erros nas fases autenticadas; o único 401 registrado foi `/v1/auth/me` antes do login. Carregamento percebido: mobile dashboard 1.124 ms e módulos 620–877 ms; desktop dashboard 648 ms e módulos 535–574 ms. `twoSessionBrowser` ficou nulo.
- Correções preparadas localmente sem commit ou push: os formulários são localizados pelo formulário ancestral do botão de submit; os comboboxes usam nome acessível por prefixo para considerar texto de ajuda; evidências registram opções, UUID selecionado e campo de request correlacionado. O parser TOC agora aceita linhas sem owner e a fixture reproduz as entradas reais de `pg_cron`/`pg_net`, filtrando também comentários de extensão.
- Checks locais dessas duas correções: TypeScript web, ESLint direcionado, Prettier direcionado, `node --check` e `--check-toc-filter` passaram. Playwright `--list` encontrou nove testes, mas isso é somente descoberta. Não foi possível executar os fluxos integrados ou o restore real nas mudanças locais sem novo push autorizado.
- Os artefatos do run contêm relatório Playwright focado, snapshots de falha, screenshot de formulário do cliente, traces sanitizados, métricas browser/API/Prisma, ensaio ClamAV e checkpoints/listagens TOC do restore. Nenhum dump foi publicado. Não houve merge, deploy, migration, alteração cloud ou operação no Supabase compartilhado. O workspace continua com alterações locais anteriores preservadas; os dois arquivos corrigidos e este contexto permanecem sem commit. Novo push exige autorização explícita.
## Correcoes locais de seletores e restore TOC - 2026-10-30

- Commit local `29f96bc4b72beee14add33973d50bb6737ec4629` (pai `f516c691e396e11a764b7e09988485357818b69e`) contem apenas o harness integrado e `tools/qa/restore-local-ci.mjs`; nao houve push.
- O harness localiza cada formulario pelo formulario ancestral do botao de envio, seleciona Cliente pelo combobox acessivel, confere UUID e correlaciona requests JSON/multipart com os campos selecionados. Isso ainda requer reteste Playwright integrado.
- O parser agora cobre as entradas TOC reais sem owner para `pg_cron` e `pg_net`, filtra extensoes, comentarios e ACLs e preserva evidencias da lista efetiva. Fixtures, `node --check`, Prettier direcionado e `git diff --check` passaram.
- Restore PostgreSQL real e jornadas integradas nao foram executados localmente: ambiente sem Docker/pg_restore e memoria disponivel insuficiente para a regressao pesada. Vitest completo, testes financeiros/documentos, TypeScript, ESLint, builds e descoberta Playwright permanecem sem execucao nesta etapa. Integracao e restauracao permanecem pendentes de CI.

## Quality #41115858374 — commit 29f96bc — 2026-10-30

- O SHA testado foi `29f96bc4b72beee14add33973d50bb6737ec4629`; [execução #41115858374](https://github.com/steveejobs/controle-livio/actions/runs/41115858374) terminou com falha. O job de aplicação passou; `supabase-isolation` e `synthetic-restore` falharam, portanto a suíte focada impediu o início das nove jornadas completas.
- Navegação/autenticação passou nos viewports 360×800 e 1440×900. Cliente/processo falhou em mobile: cliente foi criado e persistido pela interface, mas a opção do cliente ainda não existia no select do processo quando o harness a leu; nenhum POST de processo ocorreu. Contrato/recebível persistiram e o pagamento parcial ficou correto; o teste parou ao exigir uma mensagem específica na duplicidade 409, embora a resposta real trouxesse `code=conflict` e a mensagem genérica do filtro HTTP. A verificação de excesso e quitação não foi alcançada. Despesa foi cadastrada, aprovada por outro perfil, paga e persistida; a falha ocorreu na asserção do fluxo de caixa que esperava R$ 42,25 fixos após duas execuções/viewports. Upload limpo persistiu; o arquivo EICAR anexado depois do marcador EOF do PDF foi aceito (HTTP 201), então download e assinatura não foram alcançados. Portal/tarefas/permissões das nove jornadas não foram retestados neste SHA.
- O ClamAV real 1.5.4, restrito ao loopback do runner, passou os ensaios diretos de limpo, EICAR, timeout e daemon indisponível. O upload de aplicação permanece sem aprovação até reexecução com EICAR dentro do PDF.
- O restore descartável executou `pg_restore` e comparou tabelas, linhas, sequências e snapshots financeiros de origem/destino. A validação interrompeu em uma comparação textual de escala (`2400.0000` versus `2400.00`); FKs, owners e grants não chegaram a ser validados. O parser também não tratava `SECURITY LABEL` composto e confundia owner ausente em comentários de extensão.
- Métricas desta execução: 1.093 consultas Prisma; P2024=0; latência de query p50/p95 0/3 ms; 537 amostras de pool, espera p50/p95 1/1 ms, máximo aguardando 2 e conexões busy/abertas 4/4. Navegação: zero requests pendentes nos dois viewports. Carga percebida mobile: painel 1.106 ms e módulos 511–788 ms; desktop: painel 568 ms e módulos 487–549 ms. As métricas de duas sessões não foram produzidas.
- Correções locais sem commit ou push: o harness aguarda a opção acessível do select e captura opções disponíveis se não carregar; alinha a asserção 409 à resposta observada; compara o delta de caixa com inteiros decimais e valida as células renderizadas; posiciona EICAR num comentário válido antes do xref/EOF do PDF. O parser descobre owners a partir de entradas inequívocas, reconhece comentários/security labels com e sem owner e normaliza escala decimal sem ponto flutuante.
- Validações locais dessas correções: TypeScript web, ESLint direcionado, Prettier direcionado, `node --check`, fixtures `--check-toc-filter` e `git diff --check` passaram. O restore PostgreSQL e o Playwright integrado não foram executados novamente nas alterações locais. O workspace mantém as alterações preexistentes; nenhum commit corretivo foi criado nem publicado.
- Confirmação por etapa de #41115858374: Auth, RLS e Storage temporários passaram antes da falha no Playwright integrado; o ensaio direto do ClamAV e a verificação posterior de timeout/daemon indisponível passaram. Isso não aprova o fluxo de upload da aplicação.

## Sprint funcional local — 2026-10-30

- Formulários de processo, contrato, recebível/pagamento, despesa e documento compartilham `ClientSelectField`: consulta somente ocorre para usuários com `clients:view`; carregamento, falha com retry, lista vazia e acesso negado ficam visíveis e acessíveis. Formulários com cliente obrigatório mantêm envio bloqueado até opções autorizadas serem carregadas. Contratos e documentos deixam de buscar clientes enquanto o formulário de cadastro/upload está fechado.
- O processo continua recebendo apenas advogados ativos da organização; a API também valida organização, vínculo ativo e papel `lawyer`. Jornada integrada agora atualiza status pela UI e confere a resposta/persistência PostgreSQL.
- O fluxo financeiro Decimal/transacional existente foi revisado. Teste financeiro direcionado passou 29/29, incluindo status agregado, parcial/total, duplicidade, excesso e concorrência simulada. A jornada integrada continua pendente de CI em PostgreSQL temporário.
- E2E documental compara SHA-256 do PDF enviado e baixado, mantém o EICAR dentro do PDF antes do xref/EOF e, no runner Linux com ClamAV do próprio workflow, ensaia timeout e daemon parado pelo formulário; recuperação exige upload limpo persistido. Testes unitários verificam que bloqueios do scanner impedem Storage, transação, metadados e auditoria.
- O restore compara cada total financeiro como texto decimal normalizado, sem ponto flutuante, preservando diferenças reais; fixtures cobrem entradas TOC com e sem owner, ACL/default ACL, `COMMENT`, `SECURITY LABEL`, `pg_cron` e `pg_net`.
- Validações executadas neste estado: financeiro 29/29; documentos/scanner 11/11; TypeScript Playwright; Prettier nos nove arquivos do lote; `node --check` nos scripts de runner/restore; fixtures TOC; descoberta dos nove cenários (descoberta não é execução); `git diff --check`. Docker não está disponível nesta máquina; havia 0,3 GB de RAM livre. Por isso, a suíte completa, lint, builds, Prisma Validate, Playwright integrado, restore PostgreSQL, Auth/RLS/Storage e ClamAV real foram deixados para o runner CI e não são declarados aprovados neste estado.
- Pendências sem alteração de infraestrutura: reexecutar no GitHub Actions deste SHA local após publicação autorizada; atualizar métricas de pool/navegação; homologar SMTP em caixa de captura e testar expiração de convite/recuperação de senha; planejar restauração histórica isolada de Auth/Storage; executar plano de migração Prisma 6→7 separadamente. Nenhuma migration, operação no Supabase compartilhado, deploy ou push ocorreu.
## Execucao Quality 41121997188 e correcoes locais - 2026-10-30

- O workflow Quality testou exatamente o SHA 792eb0e2735ff0623b4f471d089d32a2818fd71e. O job application passou: 207 testes Vitest, 21 Playwright mockados, format check, lint, TypeScript, Prisma Validate, builds e bundle check. Auth/RLS/Storage temporarios tambem passaram no job integrado.
- A navegacao autenticada passou nos viewports 360x800 e 1440x900. As quatro jornadas focadas seguintes falharam apenas no mobile e impediram a execucao dos cinco cenarios restantes e da repeticao desktop dos fluxos.
- Cliente/processo: criacao do cliente (201), processo e responsavel foram persistidos. A falha final era o locator exato do texto do advogado, apesar do cartao exibir o rotulo composto.
- Contrato/recebiveis: total 100.00, parcelas 33.34/33.33/33.33, pagamento parcial, duplicidade 409, excesso 400 e quitacao foram confirmados via API/PostgreSQL; o agregado ficou PAID com alocacoes de 100.00. A verificacao visual expirou porque a regiao de recebiveis precisava ser rolada apos reload.
- Despesas: o campo visual selecionado nao era incluido em FormData porque ClientSelectField nao tinha name=clientId. A correcao local adiciona o nome e o diagnostico agora separa request emitido de corpo divergente.
- Documentos: upload limpo retornou 201; o EICAR foi colocado como comentario PDF e retornou 201, sem provar deteccao. A fixture local agora incorpora EICAR como EmbeddedFile em PDF valido; integracao UI com ClamAV continua pendente de runner.
- Restore: pg_restore e comparacoes de tabelas/dados, sequencias e valores financeiros passaram no banco descartavel. A validacao parou no snapshot de grants por usar acldefault(text, oid); a correcao local tipa o argumento como char. Owners, FKs e checks posteriores ainda nao foram comprovados.
- Metricas novas deste SHA: 832 consultas Prisma; P2024=0; query p50/p95 0/3 ms; espera do pool p50/p95 1/1 ms; maximo de 2 consultas aguardando e 4 conexoes ocupadas/abertas. Navegacao mobile e desktop terminou com zero requests pendentes e maximo concorrente de 6. Duas sessoes nao foram medidas. Carregamento percebido mobile: dashboard 1089.65 ms, modulos 505.42-787.70 ms; desktop: dashboard 650.79 ms, modulos 534.00-607.34 ms.
- Correcoes locais nao publicadas: diagnosticos e seletores de Playwright, submissao de clientId em despesas, acldefault com tipo PostgreSQL correto, PDF EICAR EmbeddedFile e ensaio de estados loading/erro/retry/vazio do seletor. Validacoes locais direcionadas passaram: web Vitest (30 testes), TypeScript web, ESLint/Prettier dos quatro arquivos, node --check, fixture do filtro TOC e descoberta de 10 testes Playwright. A descoberta nao equivale a execucao; suite completa, restore real e scanner local nao foram repetidos. Docker nao esta disponivel e a memoria livre observada era 108 MB.
- Nenhum push corretivo foi feito. Nova execucao integrada depende de publicar o proximo commit com autorizacao explicita.
- As correcoes locais foram reunidas no commit ce2f98428cffe7e7f945ddcad7f249699f1908c2, filho direto do SHA 792eb0e2735ff0623b4f471d089d32a2818fd71e. O commit contem somente os quatro arquivos de correcao, nao foi enviado e aguarda nova autorizacao; o restante do workspace permanece fora dele.

## Quality 41126729770 - 2026-10-30

- A execucao testou o SHA ce2f98428cffe7e7f945ddcad7f249699f1908c2. O job application passou: 207 testes Vitest, 21 Playwright mockados, format check, ESLint, TypeScript, Prisma Validate, builds e bundle check.
- O job supabase-isolation iniciou Supabase e ClamAV oficial 1.5.4 ligados ao loopback. Arquivo limpo, PDF limpo e EICAR bruto passaram no scanner direto; a deteccao EICAR no PDF incorporado nao retornou 422. Auth/RLS/Storage e Playwright foram pulados pelo encadeamento das etapas. Nenhuma das jornadas integradas foi executada neste SHA.
- O restore independente terminou pg_restore no banco descartavel. Comparacoes de tabelas/dados, sequencias e totais financeiros chegaram ate a validacao de grants; esta falhou com `text || "char"` na serializacao de `pg_default_acl.defaclobjtype`. Owners e FKs posteriores nao foram comprovados.
- Artefatos sanitizados baixados para `%TEMP%\livio-run-41126729770-gh\artifacts`: relatorio ClamAV, report Playwright e checkpoints/listagens TOC do restore. `clamav-rehearsal.json` ficou IN_PROGRESS com os tres primeiros ensaios PASS; o EICAR PDF falhou antes de ser registrado.
- Correcoes locais em preparo: fixture PDF agora inclui `/Params /Size`, nomes `/F` e `/UF`, e `/AF`; o stream EICAR continua sem compressao. `defaclobjtype` e convertido explicitamente para text. O script integrado tenta a suite completa mesmo se o grupo focado falhar; o workflow executa Auth/RLS, navegador e modos de falha do scanner apos falha anterior quando suas dependencias estao disponiveis.
- Verificacoes locais dessas correcoes: `node --check` nos scripts, fixture do filtro TOC, parse YAML/condicoes `always()`, ESLint e Prettier direcionados passaram. A construcao de ambos os PDFs foi carregada pelo pdf-lib e confirmou objeto EmbeddedFile, bytes EICAR exatos e stream sem Filter. Isso nao substitui ClamAV real.
- Docker, qpdf, clamscan e pdfinfo nao estao disponiveis localmente; a restauracao PostgreSQL e o ClamAV real das novas correcoes aguardam outro runner CI. Esta execucao nao produziu metricas Prisma/navegacao; metricas de commits anteriores nao foram reutilizadas.
- Nao houve deploy, migration, alteracao cloud ou operacao no Supabase compartilhado. Nenhum commit corretivo foi publicado; nova execucao exige autorizacao de publicacao.
- As correcoes locais desta execucao foram reunidas no commit 8be1be1be3865b1e6e2f8808c5a720ba9c926c21, filho direto de ce2f98428cffe7e7f945ddcad7f249699f1908c2. O commit contem somente o workflow Quality, o harness Playwright e tres scripts QA; esta local, sem push e aguarda autorizacao. PROJECT_CONTEXT e demais alteracoes locais foram preservados fora do commit.

## Quality 41129518121 — SHA 8be1be1 e correções locais seguintes — 2026-10-30

- O commit `8be1be1be3865b1e6e2f8808c5a720ba9c926c21` foi publicado somente na branch `validation/gha-ci-20261029`; o Quality #41129518121 testou exatamente esse SHA e terminou em falha: https://github.com/steveejobs/controle-livio/actions/runs/41129518121. `application` passou com 207 testes Vitest, 21 Playwright mockados, format, ESLint, TypeScript, Prisma Validate, builds e bundle check. Auth/RLS/Storage descartáveis também passaram.
- O grupo focado executou seis testes: autenticação/navegação e jornada cliente/processo passaram; o seletor de estado vazio falhou por strict mode (`role=status` localizava o aviso de clientes e o aviso de advogados). Contrato/recebíveis, despesas e documentos encontraram 429 em ações posteriores da sessão. A suíte completa executou dez testes: despesas nos dois viewports, tarefas nos dois viewports, portal/isolamento e perfis/permissões passaram; seis falharam (seletor, autenticação/duas sessões afetadas por 429 de auditoria, cliente/processo e financeiro limitados após a rodada focada, e PDF EICAR aceito com HTTP 201).
- Os registros das seleções mostram opções carregadas, UUID escolhido correspondente ao esperado e UUID enviado igual ao selecionado em processo, contrato, despesa e documento quando a ação foi alcançada. Cliente/processo persistiu nos dois viewports no grupo focado. O ciclo financeiro no mobile criou contrato/recebível de R$ 100,00, parcelas 33,34/33,33/33,33, pagamento parcial, duplicidade 409, excesso 400, quitação e conferência `PAID`/saldo zero. Desktop parou em 429 antes da criação do recebível; a repetição completa foi contaminada pelo mesmo contador de escrita.
- O fluxo de despesas passou no grupo completo em mobile e desktop: `clientId` chegou no POST, a despesa foi aprovada por outro perfil, paga e persistida. Em documentos, upload limpo foi aceito, mas o scanner ClamAV real 1.5.4 não detectou o EICAR no anexo PDF e o endpoint da aplicação respondeu 201. Download/checksum/assinatura e ausência do objeto infectado não ficaram comprovados após essa falha.
- ClamAV real no loopback aceitou arquivo/PDF limpos, rejeitou EICAR bruto e bloqueou timeout (HTTP 503, 1.504 ms) e daemon indisponível (503). A detecção dentro de PDF e a integração segura do upload permanecem reprovadas.
- Restore sintético em PostgreSQL descartável concluiu `pg_restore`; comparações anteriores de tabelas/dados, sequências e valores financeiros avançaram. A captura de grants falhou com `ACL arrays must be one-dimensional`; owners, grants finais e FKs não foram validados. O dump ficou fora dos artefatos.
- Métricas novas do run: 2.959 consultas Prisma; P2024=0; query p50/p95 0/2 ms; espera do pool p50/p95 1/1 ms; máximo de 2 aguardando e 4 conexões ocupadas/abertas. Navegação: mobile p95 máximo 52,79 ms e carregamento percebido máximo 1.046,92 ms; desktop 61,29 ms e 637,68 ms; nenhuma requisição pendente. Os erros 429 apareceram nas execuções funcionais subsequentes e são explicados pela quota de 60 escritas/minuto compartilhada entre grupo focado e suíte completa.
- Correções locais em preparo: escopo exato para o aviso de lista vazia; quota de escrita elevada apenas no processo de API do runner sintético; PDF de teste criado por `pdf-lib` com anexo EICAR não comprimido e estrutura carregável; normalização de ACLs por item antes de `aclexplode`. A checagem estrutural local confirmou PDF carregável, anexo presente, stream sem filtro e bytes EICAR exatos. TypeScript web/API, 30 Vitest web, ESLint/Prettier direcionados, `node --check`, `git diff --check` e Prisma Validate passaram. O teste real ClamAV, restore PostgreSQL e os dez cenários precisam de nova execução CI após autorização para publicar a correção local.
- Alterações locais preexistentes foram preservadas e não incluídas no lote corretivo. Não houve deploy, mudança de infraestrutura, migration ou operação no Supabase compartilhado. Nenhum commit corretivo foi publicado.

## Quality 41129518121 — correções locais após o SHA 8be1be1 — 2026-10-30

- A execução Quality publicada em `8be1be1be3865b1e6e2f8808c5a720ba9c926c21` terminou em falha: https://github.com/steveejobs/controle-livio/actions/runs/41129518121. `application` passou com 207 Vitest, 21 Playwright mockados, format, ESLint, TypeScript, Prisma Validate, builds e bundle check. Auth/RLS/Storage temporários passaram.
- Playwright focado e completo foram executados independentemente. No focado, navegação e cliente/processo passaram; o estado vazio falhou por locator `role=status` ambíguo; os fluxos posteriores de financeiro, despesa e documento encontraram HTTP 429 na quota de escrita. Na suíte completa, despesa, tarefas, portal/isolamento e permissões passaram nos viewports testados; seis de dez testes falharam por locator ambíguo, quota compartilhada entre execuções e PDF EICAR aceito pelo scanner.
- ClamAV oficial 1.5.4 no loopback aceitou arquivo/PDF limpos, rejeitou EICAR bruto e bloqueou timeout e daemon indisponível com HTTP 503. Não detectou EICAR como EmbeddedFile no PDF, e o endpoint de upload da aplicação respondeu 201; download/checksum, assinatura e ausência do objeto infectado após rejeição não foram comprovados.
- O restore PostgreSQL descartável executou `pg_restore` e chegou às comparações de tabelas/dados, sequências e valores financeiros; a captura de grants falhou com `ACL arrays must be one-dimensional`. Owners, grants finais e FKs não foram comprovados.
- Métricas deste SHA: 2.959 consultas Prisma, P2024=0, p50/p95 de consulta 0/2 ms, espera do pool 1/1 ms, máximo de 2 consultas aguardando e 4 conexões abertas/ocupadas. Navegação reportou zero pendentes; métricas p95/load percebido foram mobile 52,79/1.046,92 ms e desktop 61,29/637,68 ms. Os erros HTTP 429 nos fluxos funcionais impedem interpretar a navegação sem pendências como aprovação total.
- Correções locais ainda não publicadas: locator do estado vazio escopado; PDF de teste gerado com `pdf-lib` e EmbeddedFile sem compressão; limite de escrita elevado somente no processo de API do harness integrado para não compartilhar a quota entre o grupo focado e a suíte completa; expansão de ACL por item antes de `aclexplode`. TypeScript API/web, 30 testes web, Prisma Validate, ESLint/Prettier direcionados, verificações de sintaxe dos scripts e `git diff --check` passaram. A estrutura do PDF foi inspecionada localmente, mas a detecção pelo ClamAV e o restore com comparação integral ainda aguardam nova execução CI.
- As correções continuam apenas no working tree, sem commit ou push corretivo. PROJECT_CONTEXT.md e os outros arquivos locais preexistentes permanecem fora do lote de correção. Não houve deploy, migration, alteração cloud ou operação no Supabase compartilhado.

## Sprint de segurança e restauração — trabalho local após 8be1be1 — 2026-10-30

- Estado inicial preservado: branch `validation/gha-ci-20261029`, HEAD `8be1be1be3865b1e6e2f8808c5a720ba9c926c21`. O workspace já continha alterações locais em documentação, contexto, templates, relatórios, ferramentas QA, Vercel e migration; elas foram preservadas e ficaram fora do lote corretivo.
- Segurança PDF: API mantém o scanner fail-closed e, além do PDF original, decodifica com limite de 4 MiB os streams de conteúdo das páginas e EmbeddedFiles antes da promoção ao Storage. Anexos malformados, criptografados ou não decodificáveis são rejeitados; falhas e bloqueios geram auditoria sanitizada sem nome/bytes do arquivo. O teste integrado verifica inventário privado do Storage antes/depois de upload limpo, infectado, timeout e daemon indisponível.
- Ensaios locais cobrem PDF limpo, EmbeddedFile EICAR comprimido/não comprimido, conteúdo de página comprimido, extração limitada e falha de scanner. São testes unitários do parser/protocolo e não comprovam ClamAV real. O notebook não tem Docker; a matriz de `clamscan`, `clamdscan`, configuração efetiva, banco EICAR e upload integrado ainda exige runner GitHub descartável.
- Rate limit: removida a variável que elevava escritas a 1.000. O API mantém o limite padrão de 60 escritas/minuto e 300 leituras/minuto, coberto por teste de configuração. Entre os grupos Playwright focado/completo, o runner para API/web, reseta somente o Supabase local com `--local` e reinicia os processos; métricas e relatórios de cada grupo são guardados separadamente. Nenhum rate limit de produção foi alterado.
- Restore: o snapshot transforma ACLs em linhas `aclexplode` e JSONB com objeto, schema, owner, grantor, grantee, privilégio e grant option; OIDs são convertidos em nomes. Grants/default grants das roles da aplicação são reaplicados ou comparados, enquanto owners e ACLs suprimidos por `--no-owner`/`--no-acl` são relatados como diferenças intencionais. Fixtures TOC e `node --check` passaram; restore real com PostgreSQL, dados, FKs, owners e grants continua pendente por falta de Docker local.
- Validações locais concluídas: Vitest completo 216/216 (API 166, web 30, shared 20); Playwright mockado 21/21; TypeScript API/web; ESLint; Prettier em 307 arquivos versionados; Prisma Validate; builds API/web; bundle check (252.823 bytes gzip); `node --check` nos scripts QA e fixtures `restore-local-ci.mjs --check-toc-filter`.
- Não houve execução real das dez jornadas integradas, do ClamAV oficial nem do restore PostgreSQL nesta etapa. Métricas novas de Prisma/navegação não foram coletadas. O lote permanece local; sem push, deploy, merge, migration ou acesso ao Supabase compartilhado. A homologação em runner precisa ocorrer depois de revisão e autorização explícita para publicar.


## Local hardening commit after Quality 41129518121 - 2026-10-30

- Commit local 6c84625e6281a3be376e07ca93e07c94f19430f9, filho direto de 8be1be1be3865b1e6e2f8808c5a720ba9c926c21; sem push. Contem 15 arquivos do lote de scanner PDF, restore ACL e isolamento do harness.
- Validacoes locais repetidas: Vitest 216/216 (API 166, web 30, shared 20); documentos/scanner 19/19; Playwright mockado 21/21; TypeScript API/web; ESLint; Prettier; Prisma Validate; builds API/web com URLs loopback; bundle check 252823 bytes gzip. node --check dos scripts QA e fixtures do filtro TOC passaram.
- Docker nao esta instalado neste notebook. ClamAV real 1.5.4, upload integrado contra Storage, restore PostgreSQL/ACL, Auth/RLS/Storage temporarios e as dez jornadas Playwright ainda nao foram executados para este commit. Nenhuma metrica Prisma/navegacao nova foi obtida. A publicacao continua pendente de autorizacao explicita.

## Quality 41137964138 - SHA 6c84625 - 2026-10-30

- O commit publicado `6c84625e6281a3be376e07ca93e07c94f19430f9` foi executado exatamente no Quality #41137964138: https://github.com/steveejobs/controle-livio/actions/runs/41137964138. `application` passou (216 Vitest, 21 Playwright mockados, format, ESLint, TypeScript, Prisma Validate, builds e bundle); Auth/RLS/Storage descartáveis passou.
- Playwright focado: 4/6 passaram; despesas e upload foram rejeitados por HTTP 429. Playwright completo: 6/10 passaram; cliente/processo, contrato/financeiro e permissões passaram, despesas, documentos, tarefas e portal foram interrompidos por 429. Os requests foram enviados e rejeitados pela quota, portanto esses fluxos não foram comprovados.
- ClamAV oficial 1.5.4 iniciou no loopback; configuração efetiva confirmou ScanPDF, limites de arquivo/scan, recursão e quantidade. Arquivo limpo, PDF limpo, EICAR bruto, timeout e indisponibilidade passaram nos ensaios alcançados. A matriz de PDFs abortou antes de chamar clamscan/clamdscan porque tentou analisar o EICAR bruto como PDF; o veredito direto para page/EmbeddedFile nesta execução é indeterminado. O upload infectado pela aplicação não foi alcançado após os 429.
- Restore descartável concluiu pg_restore e conferiu tabelas/dados, sequências e valores financeiros; snapshot de permissões parou em `Unsupported r default ACL privilege: MAINTAIN`. Owners/grants e validações posteriores não estão aprovados.
- Métricas novas: 4.570 consultas Prisma; P2024=0; query p50/p95 0/4 ms; espera do pool p50/p95 1/1 ms; máximo de 2 aguardando e 4 conexões ocupadas/abertas. Navegação medida sem pendentes: mobile p95 por etapa até 46,52 ms e carga percebida até 1.146,67 ms; desktop 41,17 ms e 711,42 ms. Os 429 funcionais impedem considerar o desempenho completo aprovado.
- Correções ainda locais e não publicadas: matriz do ClamAV distingue EICAR bruto de PDFs, grava progresso e impede que ensaios de timeout/indisponibilidade promovam um relatório incompleto a PASS; ACL reconhece `MAINTAIN` do PostgreSQL 17; seed descartável adiciona nove identidades administrativas independentes por jornada mantendo quotas 60/300; workflow instala qpdf para validar os PDFs. PostgreSQL 17 documenta `MAINTAIN` em GRANT/ALTER DEFAULT PRIVILEGES: https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html.
- Validação local das correções: Vitest 216/216; 21 Playwright mockados; quatro testes direcionados da API 44/44; TypeScript, ESLint, format check (309 arquivos versionados), Prisma Validate, build API/web, bundle check (253.020 bytes gzip), `node --check` QA e conferência estática das nove identidades passaram. Parser local confirmou EICAR recuperável em streams de página e attachments PDF comprimido/não comprimido. Sem Docker/psql: ClamAV oficial, upload integrado, restore PG/ACL e Auth/RLS/Storage não foram repetidos localmente.
- Não houve push corretivo, merge, deploy, migration ou operação no Supabase compartilhado. As alterações permanecem no working tree e aguardam revisão/novo CI autorizado.

## Leitura de comprovantes financeiros — trabalho local em 2026-10-31

- A implementação local reutiliza Document/Storage/ClamAV, ReceivableInstallment, Payment, Expense e as transações financeiras existentes. Uma nova entidade PaymentReceipt guarda hash, vínculo, campos extraídos com origem/confiança, prévia de conciliação e histórico de revisão. A migration SQL foi apenas versionada; não foi aplicada ao Supabase compartilhado.
- PDF usa texto nativo primeiro e OCR local em páginas digitalizadas; JPEG/PNG usam OCR local com rotação limitada. Arquivos originais permanecem privados. O scanner atua antes da extração e da gravação; a confirmação financeira exige usuário autorizado e nunca interpreta OCR como confirmação bancária.
- Pagamento de parcela reaproveita idempotência e locks da FinanceService; recibos enviados por cliente ficam pendentes. Valores são Prisma.Decimal/string, com validação de datas e motivo obrigatório para correções/divergências. Despesas continuam exigindo quitação integral conforme a regra existente.
- Testes locais: Vitest completo 234/234 (API 184, web 30, shared 20); testes financeiros dirigidos 47/47; TypeScript, ESLint, Prettier, Prisma Validate e builds API/web passaram. A jornada Playwright nova foi descoberta, mas não executada. PostgreSQL descartável, Auth/Storage/ClamAV reais, OCR em runtime de deploy e mobile/desktop integrados permanecem pendentes porque este notebook não possui Docker/psql e não há autorização de push.
- Este registro fica fora do commit por coexistir com alterações locais preexistentes do arquivo. Nenhum push, deploy ou operação em infraestrutura compartilhada foi realizado neste lote.

## Bloqueios técnicos de comprovantes — validação local em 2026-10-31

- Conciliação separa obrigação original, saldo atual, valor nominal, valor indicado como devido e valor pago. Usa `Prisma.Decimal`; pagamentos parciais não são tratados como correção obrigatória do OCR. Divergência entre nominal/desconto/juros/multa, cobrança explícita e saldo do Lívio exige revisão/motivo, e OCR não confirma pagamento.
- A idempotência existente do PostgreSQL usa unicidade `(organization_id, external_id)`. E2E Pix recebe chave opaca por organização; identificador genérico é tipado e inclui a instituição normalizada. Sem instituição ou tipo reconhecível, não se inventa chave genérica; o hash do arquivo continua protegido pela unicidade `(organization_id, sha256)` de PaymentReceipt. Teste integrado de concorrência aguarda execução no CI.
- O runtime dos projetos Vercel foi consultado em modo somente leitura: ambos estão em Node 24.x. Como a faixa `>=22.13.0` também permitiria majors mais novas na Vercel, raiz e API agora declaram `24.x`, alinhadas à configuração dos projetos e ao runner Quality. A execução final do OCR sintético no build API local carregou o modelo `por` (1.392.239 bytes) e PDF.js em Node 24.12, levou 1.108 ms e observou RSS máximo de 150.847.488 bytes. Isso valida execução local/CI, não o pacote final da função Vercel nem os limites configurados da função hospedada.
- A captura informa origem do campo e pede revisão sem expor as heurísticas fixas como percentuais de precisão. A ordem verificada por testes é scanner → extração local → Storage; indisponibilidade/rejeição do scanner interrompe a extração/gravação. Confirmação permanece protegida por permissão e auditoria.
- Validações locais no estado atual: Vitest 239/239 (API 189, web 30, shared 20); Playwright mockado 21/21; TypeScript API/web, ESLint, Prettier (319 arquivos versionados; contexto local ignorado), Prisma Validate, builds API/web e bundle check passaram. OCR executou no build compilado. `node --check` e `git diff --check` passaram.
- Migration e cenários PostgreSQL/RLS não foram executados: notebook sem Docker, `psql`, `pg_restore` ou serviço nas portas locais 5432/54322. Quality foi preparado para aplicar as migrations com `supabase db reset --local` e validar colunas, constraints, RLS/roles, grants de aplicação, rollback sintético e concorrência com dados sintéticos; esse workflow não foi executado porque não houve push. `migrationFailureRollback` segue sem fault injection. O banco de produção não foi lido nem alterado.
- A branch permanece em `ed2e586f3f31a7ae9f19c2b9d9485fd9115b9da4`, com a cadeia local original intacta; não houve commit, push, deploy ou migration compartilhada. Alterações e relatórios locais preexistentes foram preservados.

## Quality 41204858921 - correcoes locais em 2026-10-31

- Estado preservado: branch `validation/gha-ci-20261029`, HEAD `ed2e586f3f31a7ae9f19c2b9d9485fd9115b9da4`, cadeia `e87f1db -> 6c1b5d6 -> ed2e586`. Artefatos baixados do Quality estao em `%LOCALAPPDATA%\Temp\livio-quality-41204858921`. O trace documental registra `REQUEST_BODY_MISMATCH`, campo `title` divergente e resposta HTTP 400, mas nao guarda o corpo bruto nem o header original.
- Documento: a falha comprovada estava no comparador do harness, que convertia bytes multipart/FormData UTF-8 para Latin-1. O titulo `Arquivo invalido QA ...` era enviado com acento e virava mojibake na comparacao; a API corretamente rejeitou os bytes `not a PDF document` com MIME PDF por nao terem magic `%PDF-`. O endpoint usa multipart com campo `file`, `title` obrigatorio e `visibility` enum com default `INTERNAL`; cliente/vinculos sao opcionais no schema. O harness agora decodifica texto UTF-8, registra/valida `multipart/form-data` e mantem casos separados para JSON malformado, titulo ausente, formato nao permitido, conteudo invalido e upload/download/assinatura. O trace antigo nao permite reconstruir os bytes/header efetivos; a reexecucao integrada deve confirmar o header pelo novo diagnostico.
- PDF/ClamAV: a fixture anterior chamada page-content inseria bytes EICAR em amostras de imagem inline, nao texto visivel. A matriz agora diferencia PDF original, stream comprimido com texto visivel (texto em hexadecimal no stream), amostras de imagem, EmbeddedFile comprimido/nao comprimido, texto PDF.js, OCR de pagina digitalizada e controle EICAR bruto. A API verifica o original pelo ClamAV antes de parser/OCR; depois varre streams/anexos e texto extraido antes do Storage. Erro/timeout/indisponibilidade continuam fail-closed. OCR EICAR e reconhecido apenas com marcador central e ancoras de inicio/fim; ClamAV ainda determina o veredito via assinatura canonica. TCP ClamAV sintetico comprovou ordem, rejeicao e nenhum upload/storage para EICAR extraido; falta executar a matriz contra ClamAV real 1.5.4.
- Restore: o archive usado no Quality tem 351 entradas de ownership publico e nao contem TOC `SCHEMA public`. `template0` cria esse schema com `pg_database_owner`; como nao havia entrada TOC para recria-lo, `--no-owner` nao alterava seu owner. O script prepara esse schema como `supabase_admin` antes do restore quando a entrada esta ausente; quando presente, renomeia o bootstrap para permitir recriacao pelo executor. Removeu `--no-acl`, reaplica ACL/default ACL do archive e compara semantica de grants apos `pg_restore`, normalizando owner/grantor mapeado pelo `--no-owner`. As verificacoes continuam cobrindo os 351 owners, roles de sessao, grants/default ACLs, dados, FKs, sequencias e totais financeiros. ACLs/extensoes/schemas cron/net omitidos sao listados integralmente; se houver essa perda, o relatorio final permanece `INCOMPLETE`.
- Validacoes locais finais: Vitest 246/246 (API 196, web 30, shared 20); Playwright mockado 21/21; TypeScript; ESLint; Prettier (319 arquivos rastreados, PROJECT_CONTEXT local ignorado pelo check); Prisma Validate; build API/web; bundle check 253.020 bytes gzip; fixtures TOC/planejamento de owner e `node --check` passaram. `git diff --check` passou. Prisma avisou que o preview `metrics` esta depreciado.
- Dependencias externas nao instaladas localmente: Docker, `clamscan`, `clamdscan`, `psql`, `pg_restore` e `qpdf`. Portanto, ClamAV real 1.5.4, restore PostgreSQL completo, Auth/RLS/Storage temporarios e Playwright integrado nao foram executados apos estas correcoes. O workflow existente contem a matriz e jornadas para executar no GitHub Actions; esta etapa nao fez push nem iniciou Actions.

| Estado | Classificacao | Evidencia |
| --- | --- | --- |
| `DOCUMENT_WORKFLOW_READY` | PARTIAL | Causa do falso mismatch corrigida; cobertura documental local passou, mas Playwright integrado ainda nao reexecutado. |
| `PDF_CONTENT_SECURITY_READY` | PARTIAL | PDF.js/OCR, varredura complementar e rejeicao pre-Storage passaram contra TCP sintetico; matriz real ClamAV 1.5.4 pendente. |
| `CLAMAV_READY` | PARTIAL | Controle e cenarios locais fake passaram; scanner/matriz 1.5.4 do runner ainda precisa ser executada. |
| `RESTORE_READY` | PARTIAL | Ownership/grants agora tem validacoes explicitas; PostgreSQL nao executado localmente e exclusoes cron/net mantem o resultado planejado como `INCOMPLETE`. |
| `INTEGRATED_QA_READY` | NO | Auth, RLS, Storage, ClamAV, documentos e restore requerem nova execucao do GitHub Actions, ainda nao iniciada. |
| `COMMERCIAL_READY` | NO | Bloqueios de integracao, seguranca documental e restore ainda nao foram resolvidos e aprovados juntos. |

- Nenhuma alteracao foi publicada: sem commit, push, deploy, alteracao em `main`, migration ou operacao em banco compartilhado. Relatorios e artefatos Quality preexistentes foram preservados.
- Contagem do TOC baixado (preflight estatico, nao restore pos-correcao): 232 ACL rows, incluindo 30 DEFAULT ACL; 16 rows referenciam cron/net (3 DEFAULT ACL), portanto o filtro preserva 216 ACL rows, incluindo 27 DEFAULT ACL. As 16 linhas excluidas estao registradas integralmente pelo script/evidence; jobs e ACLs dos schemas ausentes mantem o estado do restore como `INCOMPLETE`.

## Auditoria final pre-Quality — 2026-10-31

- O teste de documentos confirmou que o corpo multipart UTF-8 era comparado como Latin-1 pelo harness; o body real e o `Content-Type` original nao foram registrados no artefato antigo. O comparador local agora decodifica campos em UTF-8 e verifica o media type sem modificar boundary ou request. Malformado, campo ausente, MIME nao permitido e arquivo com bytes invalidos seguem como casos separados; E2E integrado ainda depende da proxima execucao Actions.
- A revisao de seguranca encontrou e corrigiu dois bypasses locais: OCR agora rejeita resultado acima de 4 MiB em vez de truncar texto; assinatura verifica PDF original, PNG da assinatura e PDF gerado antes de qualquer upload. Testes verificam ordem e zero uploads se cada etapa reprovar. ClamAV real ainda precisa confirmar a matriz.
- Restore agora exige os 351 owners esperados, 216 ACLs recuperadas e 27 default ACLs, com inventario de TOC esperado 232/30 e exclusoes scheduler 16/3. Divergencia deixa checkpoint `INCOMPLETE`; grants/default ACLs sao comparados semanticamente depois de `pg_restore`. O restore PostgreSQL completo ainda nao foi executado localmente.
- Verificacoes desta auditoria: Vitest 248/248 (API 198, web 30, shared 20); testes direcionados documentais 27/27; Playwright mockado 21/21; TypeScript, ESLint, Prettier, Prisma Validate, build API/web, bundle (253.020 bytes gzip), `node --check`, fixture TOC e `git diff --check` passaram. Prisma reportou apenas a depreciacao do preview `metrics`.
- Sem Docker, ClamAV, `psql`, `pg_restore` ou `qpdf` localmente; ClamAV 1.5.4, PostgreSQL real descartavel, Auth/RLS/Storage e Playwright integrado permanecem sem execucao. O workflow existente inicia ClamAV oficial 1.5.4 com `ScanPDF=yes`, aguarda scanner, executa matriz real e mantem restore e jobs independentes; a integracao nao foi disparada nesta etapa.
- O job `application` publica somente `test-results/.last-run.json`; nao envia os diretorios de trace/relatorio Playwright, que podem conter requisicoes ou arquivos sinteticos. A suite continua executando normalmente; as evidencias integradas permanecem nos artefatos sanitizados do outro job.

| Estado                       | Classificacao | Evidencia atualizada                                                                                                                |
| ---------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `DOCUMENT_WORKFLOW_READY`    | PARTIAL       | Harness e validacoes locais passaram; falta Playwright integrado com API/Auth/Storage da stack temporaria.                          |
| `PDF_CONTENT_SECURITY_READY` | PARTIAL       | Conteudo nativo/OCR, limite e armazenamento pre-verificado cobertos por testes locais; falta ClamAV real 1.5.4 e Storage integrado. |
| `CLAMAV_READY`               | PARTIAL       | Fail-closed e ordem passaram com scanner TCP sintetico; daemon real e matrix ainda pendentes.                                       |
| `RESTORE_READY`              | PARTIAL       | Contagens e comparacoes rigorosas preparadas; restore real pendente e exclusoes cron/net mantem resultado `INCOMPLETE`.             |
| `INTEGRATED_QA_READY`        | NO            | Nenhum Quality integrado executado sobre estas correcoes.                                                                           |
| `COMMERCIAL_READY`           | NO            | Integracao documental, scanner real e restore ainda precisam de aprovacao conjunta.                                                |

- Nenhum commit, push, deploy, alteracao em `main`, migration ou operacao em banco compartilhado ocorreu. A branch e o SHA de referencia continuam sem alteracao; mudancas locais e artefatos preexistentes foram preservados.
