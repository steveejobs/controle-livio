# Controle Financeiro Lívio

CRM jurídico e controle financeiro multiempresa. Supabase é a plataforma única de dados: Database,
Auth, Storage e Row Level Security. A API NestJS permanece responsável por operações críticas e o
Prisma é o ORM tipado, não o executor de migrations.

## Requisitos

- Node.js 22+ e npm 10+;
- Docker Desktop em execução;
- Supabase CLI instalada pelo `npm install`.

Não instale PostgreSQL, Auth ou Storage paralelos para o produto.

## Subir a fundação local

```powershell
npm install
npm run supabase:start
npm run supabase:status
```

Copie `.env.example` para `.env` e substitua somente os placeholders pelas credenciais retornadas
pela stack local. Em seguida, recrie o banco local exclusivamente pelo histórico versionado:

```powershell
npm run db:migrate:dev
npm run test:supabase
npm run dev
```

`db:migrate:dev` executa `supabase db reset`: é destrutivo e permitido somente quando
`SUPABASE_LOCAL=true`, em `development` ou `test`. O reset aplica todas as migrations e
`supabase/seed.sql`, com duas organizações e usuários exclusivamente fictícios. As credenciais locais
estão comentadas no próprio seed e nunca devem ser reutilizadas fora da stack local.

- Web: `http://localhost:3000`
- API: `http://localhost:3001/v1`
- OpenAPI: `http://localhost:3001/v1/docs`
- Studio: `http://localhost:54323`
- Caixa de e-mail local (Inbucket): `http://localhost:54324`

## Auth e organização

O login, refresh, recuperação e logout usam Supabase Auth. O Next mantém a sessão com `@supabase/ssr`
e envia o access token à API como Bearer JWT. A API valida o token no Supabase e resolve:

```text
auth.users → profiles → organization_members → organization_member_roles → roles → permissions
```

`organization_id` nunca é aceito como prova de autorização. Quando houver mais de uma membership,
`X-Organization-Id` apenas seleciona uma organização; a API exige uma membership ativa correspondente.
As tabelas legadas `sessions` e `password_reset_tokens` permanecem somente como arquivo de schema e
não participam do runtime.

## Primeiro administrador

O bootstrap usa Supabase Auth Admin no servidor e não grava senha própria:

```powershell
npm run bootstrap:admin
```

Defina fora do Git `BOOTSTRAP_ORGANIZATION_SLUG`, `BOOTSTRAP_ORGANIZATION_NAME`,
`BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL` e `BOOTSTRAP_ADMIN_PASSWORD`. Ambiente remoto exige
`ALLOW_REMOTE_BOOTSTRAP=true` e project ref confirmado; produção exige também
`ALLOW_PRODUCTION_BOOTSTRAP=true`. O script é idempotente para organização, perfil, membership, papel
e permissões e nunca imprime senha ou token.

## Migrations

`supabase/migrations` é o único histórico oficial e Supabase CLI é o único executor:

1. `20260807134500_initial_foundation.sql` — schema inicial, constraints e tenant triggers;
2. `20260807170000_finance_document_links.sql` — documento→contrato, documento→despesa e despesa→cliente;
3. `20260807180000_supabase_auth_rls.sql` — vínculo Auth inicial, RLS e bucket privado;
4. `20260809120000_auth_memberships_hardening.sql` — profiles, memberships, Auth definitivo e hardening RLS/Storage.

Estado cloud em 2026-08-09: as quatro migrations acima foram aplicadas ao projeto Supabase remoto
configurado, que estava vazio. A verificação posterior encontrou 39 tabelas com RLS habilitada e
forçada, 141 policies, bucket privado, zero objetos e zero usuários Auth. Nenhum seed foi aplicado
remotamente. O primeiro administrador ainda deve ser criado com `npm run bootstrap:admin`.

O histórico Prisma em `packages/db/prisma/migrations` é arquivo imutável e não é executado. Para um
remoto confirmado, apenas após validar localmente:

```powershell
npm run db:migrate:status
npm run db:migrate:deploy
```

Produção exige `ALLOW_PRODUCTION_MIGRATION=true`. Nunca use reset, seed ou E2E em remoto persistente.

## Qualidade

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:supabase
npm run db:validate
npm run build
```

`test:supabase` exige stack local e prova isolamento entre duas organizações, roles, nota interna e
Storage. Leia [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md),
[docs/SUPABASE_ARCHITECTURE.md](docs/SUPABASE_ARCHITECTURE.md) e [docs/SECURITY.md](docs/SECURITY.md).

## SMTP, backup e restauração

Auth local entrega e-mails no Inbucket. Antes de produção, configure custom SMTP no painel/configuração
do Supabase, domínio remetente, SPF/DKIM/DMARC e redirects permitidos.

Backup do Database e retenção/backup dos objetos de Storage são planos separados. Uma restauração deve
ocorrer primeiro em projeto isolado, reaplicar/validar RLS, memberships, tenant triggers, checks
financeiros, bucket privado e hashes dos documentos antes de qualquer promoção.
