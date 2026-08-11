# Relatório de compatibilidade do banco

- Data da inspeção: 2026-08-07
- Destino: Supabase PostgreSQL remoto
- Método: consultas somente leitura ao catálogo via Management API
- Credenciais: mantidas exclusivamente em arquivos `.env*` ignorados pelo Git

## Estado observado antes de migrations

| Verificação                             | Resultado        |
| --------------------------------------- | ---------------- |
| Saúde do projeto                        | Ativo e saudável |
| Tabelas no schema `public`              | 0                |
| Colunas/constraints/índices em `public` | 0 / 0 / 0        |
| Histórico `_prisma_migrations`          | Ausente          |
| Usuários em `auth.users`                | 0                |
| Objetos/buckets de Storage              | 0 / 0            |
| Réplica somente leitura                 | Não              |

Nenhuma tabela ou dado existente no schema de aplicação será substituído. Os schemas administrados pelo Supabase (`auth`, `storage` e demais schemas internos) não fazem parte da migration Prisma.

## Compatibilidade

A migration inicial é compatível com o estado vazio de `public`: cria enums, 36 tabelas, índices, foreign keys, checks, barreiras de tenant e proteções append-only. Ela é atômica e não contém `DROP`, `TRUNCATE`, `DELETE`, reset ou `ON DELETE CASCADE`. Não há backfill nesta migration.

## Condição para aplicação

O destino é remoto e foi tratado como potencialmente produtivo. Embora esteja vazio, não há confirmação formal de que seja desenvolvimento e o nome do projeto não identifica inequivocamente o Lívio. Portanto a migration não foi aplicada. Sua aplicação exige confirmação do project ref/ambiente, teste prévio em PostgreSQL descartável e nova varredura imediatamente anterior ao deploy. Se surgir qualquer objeto/dado, o deploy deve parar e ser replanejado com baseline/expand-and-contract.
