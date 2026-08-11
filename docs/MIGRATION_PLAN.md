# Plano de migrations

## Estrategia oficial

Desde 2026-08-07, `supabase/migrations` e o unico historico ativo e Supabase CLI e o unico executor de migrations. O Prisma permanece como ORM/validador. `packages/db/prisma/migrations` e arquivo historico imutavel e nao deve ser aplicado em paralelo.

Toda migration deve ser validada primeiro na stack local da Supabase CLI. Aplicacao remota exige project ref confirmado pelo safeguard `tools/supabase/safety.mjs`; producao exige autorizacao adicional explicita.

## Estado observado

Em 2026-08-07, consultas somente leitura confirmaram um Supabase remoto saudável, sem tabelas em `public`, sem `_prisma_migrations`, usuários Auth, buckets ou objetos. Apesar de vazio, o projeto não possui marca inequívoca de desenvolvimento e seu nome não confirma este repositório. Por isso a migration foi gerada, revisada e **não aplicada**. Veja `DATABASE_COMPATIBILITY_REPORT.md`.

## Migration inicial

`20260807134500_initial_foundation/migration.sql` cria enums, tabelas, índices, foreign keys restritivas, checks financeiros/temporais, barreiras de tenant e históricos append-only. Ela roda em transação única e não contém `DROP`, `TRUNCATE`, `DELETE`, reset ou `ON DELETE CASCADE`.

Antes do deploy:

1. Confirmar formalmente que o project ref é o ambiente correto e que o destino é desenvolvimento/homologação.
2. Repetir a inspeção do catálogo e comparar com o relatório; qualquer objeto novo interrompe o deploy.
3. Testar o SQL integral em PostgreSQL descartável compatível e executar a suíte de integração contra ele.
4. Obter backup verificável ou point-in-time recovery e definir janela de aplicação.
5. Executar apenas `npm run db:migrate:deploy`; nunca `migrate reset` ou `db push --force-reset`.
6. Verificar `_prisma_migrations`, constraints, triggers, índices e `/v1/health/ready`.
7. Criar o bucket `legal-documents` como privado e validar URL assinada com objeto de teste não sensível.

## Consolidação Supabase Auth

`20260809120000_auth_memberships_hardening.sql` é aditiva e não reescreve as três migrations
anteriores. Ela cria profiles/memberships, troca as helpers RLS para essa fonte de verdade, restringe
portal e Storage e limpa hashes próprios. Em ambiente com dados, a própria migration aborta se houver
usuário ativo sem `auth_user_id`; primeiro provisione/convide a conta no Supabase Auth. Nunca converta
hash Argon2 para formato incompatível.

## Evolução expand-and-contract

Migrations aplicadas são imutáveis. Mudança arriscada segue: adicionar estrutura compatível e opcional; publicar aplicação que lê os dois formatos; backfill idempotente em lotes; validar; tornar a nova estrutura obrigatória; retirar o legado em release posterior. Índices grandes devem ser planejados fora da transação com `CONCURRENTLY`. Constraints em tabelas volumosas entram `NOT VALID` e são validadas depois.

Rollback preferencial é roll-forward. Para uma migration ainda não aplicada, a reversão é descartar o ambiente de teste. Em ambiente persistente, scripts de reversão só podem remover estruturas comprovadamente novas e vazias, com aprovação explícita; nunca são executados automaticamente.
