# Backup pré-migration de despesas — 2026-10-28

## Resultado

- **BACKUP_EXPORT: PASS** — `pg_dump` 17.11 retornou código 0 em conexão Supabase validada na porta 5432.
- **BACKUP_ARCHIVE_CHECK: PASS** — `pg_restore --list` e extração seletiva de schema/dados concluíram com código 0; o arquivo contém o schema pré-migration e as sete despesas existentes.
- **RESTORE_TEST: NOT_TESTED** — não foi feito restore em outro banco. `pg_restore --list` e leitura seletiva não comprovam recuperação ponta a ponta.
- Migration `20261027150000_expense_workflow`: **não aplicada**. Nenhum deploy ou escrita no banco ocorreu.

## Destino e ferramenta

Project ref verificada: `ioebcdpyrszokdyaoaqv`. A URL Supabase de Auth/Storage e os hosts/usuário de banco correspondem à ref. PostgreSQL remoto respondeu versão 17.11 (`170011`). `DIRECT_URL` usa pool de sessão Supavisor na porta **5432**; o dump não usou porta 6543 nem `DATABASE_URL` transacional.

O ambiente não tinha `pg_dump`/`pg_restore` no PATH. Foram usados os binários portáteis EDB PostgreSQL 17.11, baixados fora do repositório. SHA-256 do ZIP oficial verificado antes da extração: `4b8db0930c38f6ef845db919551dedda3b6b845aeb0927b3d79a6e8e9e4537cf`. Ambos os executáveis reportaram versão 17.11.

## Arquivo

- Caminho: `C:\Users\jarde\AppData\Local\LivioLegal\Backups\expense-workflow-20261028-001\livio-public-pre-expense-migration.dump`
- Formato: archive custom do PostgreSQL, estrutura e dados do schema `public`.
- Tamanho: **735.578 bytes**.
- SHA-256: `99952799a4bcb6ed18827199760812d2be9fffc4cd38c6f51296ead26e7ec1f2`.
- Manifesto local: `C:\Users\jarde\AppData\Local\LivioLegal\Backups\expense-workflow-20261028-001\manifest.json`.
- ACL verificada na pasta e arquivo: apenas usuário Windows atual e `SYSTEM`; a pasta desabilita herança. O arquivo fica fora do checkout/Git. Não imprimi credenciais nem conteúdo de linhas.

BitLocker não está associado ao volume C: neste ambiente e o arquivo não foi cifrado com EFS. A ACL limita leitura a usuário atual e `SYSTEM`, mas o conteúdo não tem criptografia própria em repouso; perda ou furto físico do dispositivo permanece risco. Não alterei a configuração de criptografia do Windows.

## Integridade e conteúdo

- `pg_dump` usou formato custom, `--schema=public`, com dados incluídos e sem opções que removam ACLs/ownership. Código de saída: 0.
- `pg_restore --list`: código 0, 718 entradas lidas do TOC. O conteúdo inclui estrutura e dados para as seis tabelas financeiras listadas abaixo.
- Extração de schema-only: código 0. O DDL de `public.expenses` não contém `responsible_user_id`, `submitted_at`, `rejected_by_id`, `rejected_at` nem `rejection_reason`. `ExpenseStatus` contém os cinco estados antigos e não contém `REJECTED`.
- TOC confirma schema e dados de `contracts`, `receivables`, `receivable_installments`, `payments`, `payment_allocations` e `expenses`. A lista contém 45 tabelas e 45 entradas de dados, 94 índices, 48 constraints, 109 FKs, 12 funções, 90 triggers, 140 policies de RLS e 57 entradas ACL no schema `public`.
- A leitura seletiva do payload `expenses` contou **7 linhas**, sem imprimir ou manter temporário com os valores.
- Inspeção somente leitura antes e depois do dump: sete despesas, todas `DRAFT`/BRL, seis sem vencimento. Enum e histórico continuam sem a migration; 16 migrations aplicadas, última `20261022213000`.

## Escopo e limitações

Este arquivo cobre exclusivamente o schema PostgreSQL `public` e os dados contidos nele. **Não é backup completo do projeto Supabase:** não inclui `auth`/usuários Auth, schema `storage`, objetos/buckets Storage, roles globais, configuração de projeto/Vercel, Vault ou arquivos armazenados. `pg_dump --schema=public` também não exporta objetos dependentes localizados fora desse schema.

O TOC, schema-only export e SHA-256 verificam formato, estrutura e integridade de leitura. Não foi criado outro banco e não foi feito restore; portanto `RESTORE_NOT_TESTED` permanece. A cópia não deve ser tratada como prova de que uma restauração operacional foi bem-sucedida.

## Estado para próxima etapa

O dump pré-migration está pronto e o banco ficou sem modificações. A aplicação da migration ainda precisa de autorização explícita do proprietário, ciente da conexão do projeto com Vercel Production/Preview. Após essa autorização, conferir que só a migration aprovada será executada e comparar novamente a contagem/estado das sete despesas. Deploy permanece separado.
