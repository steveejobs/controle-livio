# Contexto vivo do projeto Lívio

Última atualização: 2026-08-09

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
  inspeção posterior confirmou 39 tabelas públicas com RLS habilitada e forçada, 141 policies, bucket
  `legal-documents` privado, zero objetos e zero usuários Auth.

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

- Prisma format/generate: passou.
- Lint e TypeScript agregado: passaram após a migração de Auth.
- Docker não está instalado/disponível nesta máquina; portanto `supabase start`, reset, seed e testes
  RLS/Storage reais ainda não foram executados aqui. Os scripts estão versionados, mas a fundação só
  pode ser declarada verde após essa execução em máquina/CI com Docker.
- Validação final após a última alteração de código: format check, lint, TypeScript agregado, Prisma
  validate, 19 testes da API, 8 testes shared e builds completos de shared/db/ui/API/Next passaram.
  A web ainda não possui testes próprios e encerra por `--passWithNoTests`.
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
- Provisionar a primeira organização e o primeiro administrador. O remoto continua sem usuários porque
  nome, slug, nome do administrador, e-mail e senha inicial não foram definidos, e credenciais não são
  inventadas nem gravadas no Git.
- Publicar web e API em um provedor de hospedagem, configurar domínio/HTTPS e variáveis do ambiente de
  deploy; esta execução preparou e validou os artefatos, mas não recebeu um destino de deploy.
- Validar custom SMTP, redirects e templates em staging.
- Adicionar scanner antimalware, rate limit distribuído, telemetria e alertas antes de produção.
- Ensaiar backup/restauração separados de Database e Storage.
- Testes E2E de browser continuam pendentes; esta etapa não implementa novos fluxos financeiros.
