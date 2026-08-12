# Contexto vivo do projeto Lívio

Última atualização: 2026-08-12

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
4. `20260809120000_auth_memberships_hardening.sql`.

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
- Nenhuma migration foi criada ou aplicada: notificações, papéis, documentos, recebíveis e parcelas
  reutilizam o modelo existente. O gate local após as mudanças passou em format check, lint, TypeScript
  estrito, 41 testes automatizados, Prisma validate e builds completos da API e web. O artefato Next
  respondeu HTTP 200; a interface compacta foi inspecionada em 360/390 px e as novas seções usam o
  observer compartilhado com `opacity`/`transform` e reduced motion.
- O primeiro CI desta etapa aprovou integralmente o job da aplicação. O job Supabase chegou a iniciar
  o stack e aplicar migrations/seed, mas revelou que `auth.email.enable_signup = false` desativava o
  login por e-mail dos usuários locais. A configuração foi corrigida para manter o provedor de e-mail
  ativo e bloquear novos cadastros pelo `auth.enable_signup = false`; isso afeta somente o stack local
  descartável, não a configuração Auth hospedada.

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
  redirecionamento temporário somente de `/` para `https://controle-livio-web.vercel.app`; `/v1/*`
  permanece na API sem alteração. O smoke do deploy confirmou 307 na raiz, página final HTTP 200 com
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
- Alertas desta etapa são internos e reconciliados durante o uso do sistema. Envio proativo fora do
  aplicativo exige provedor, consentimento, templates, política de retentativas e agendamento ainda
  não definidos.
- Definir domínios próprios, se exigidos pelo produto, e atualizar CORS, URL pública da API e
  redirects antes da troca dos aliases `vercel.app`.
- Adicionar scanner antimalware, rate limit distribuído, telemetria e alertas antes de produção.
- Ensaiar backup/restauração separados de Database e Storage.
- Confirmar o workflow `Quality`, inclusive RLS/Storage, após o push. O smoke responsivo público não
  substitui um E2E autenticado com mutações em banco descartável; Docker/Podman seguem indisponíveis
  nesta máquina.
