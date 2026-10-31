# Finalização do módulo de despesas — 2026-10-27

## Resultado

**Estado do módulo: PARTIAL.** A implementação local e suas validações passaram. O ciclo ainda não está ativo no banco: a migration `20261027150000_expense_workflow` foi revisada e preparada, mas não executada. Não houve deploy nem escrita remota nesta etapa.

**MIGRATION_READY_FOR_APPROVAL: YES.** “YES” significa que o SQL foi revisado para o estado observado e pode ser submetido à aprovação específica do proprietário. Não significa que a aprovação foi dada, nem que o projeto atual seja isolado: ele continua associado aos ambientes Vercel Production e Preview.

**Aplicação nesta execução: BLOCKED.** O backup recuperável não pôde ser verificado com o acesso disponível; não executei a migration nem deploy. É necessária verificação pelo proprietário no Dashboard Supabase e autorização expressa para a migration exata.

## Preparação de aplicação — 2026-10-27

- Identidade configurada: project ref `ioebcdpyrszokdyaoaqv`; o host Supabase de Auth/Storage coincide com essa ref. Auth `/auth/v1/settings` respondeu HTTP 200 e Storage `listBuckets` respondeu com sucesso (três buckets; nomes omitidos). `DATABASE_URL` passou o guardrail existente e o host/usuário de `DIRECT_URL` também corresponde à ref. A conexão SQL confirmou PostgreSQL 17.11. O projeto continua associado a Production/Preview da Vercel conforme a verificação anterior.
- Schema remoto: `REJECTED` ausente; cinco colunas ainda ausentes; somente constraints e quatro índices já existentes foram observados. Histórico Supabase tem 16 versões aplicadas, até `20261022213000`; não há outra migration pendente no banco além da migration local submetida ao dry-run.
- `npm run db:migrate:deploy -- --dry-run` executou o safeguard, mas o trecho `--linked` parou com `LegacyProjectNotLinkedError` porque `supabase/.temp/project-ref` não existe. Sem alterar esse vínculo local, executei o Supabase CLI oficial com `--db-url DIRECT_URL --dry-run`, precedido pelo mesmo `tools/supabase/safety.mjs remote-migrate`. O resultado foi `dryRun: true` e listou exclusivamente `20261027150000_expense_workflow.sql`; nenhum seed ou role foi planejado e nada foi aplicado.
- Os dois arquivos SQL foram comparados pelo hash SHA-256 e permanecem idênticos (`3F94E03D5137EE79A9A45088AB458ABCBCB441A2751AD89C4BF60F378D71EA4E`). O SQL preparado está transcrito acima.
- A contagem somente leitura antes e depois do dry-run permanece em sete despesas `DRAFT` BRL, seis sem vencimento. O SQL não contém `INSERT`, `UPDATE` ou `DELETE`; só adiciona enum, colunas anuláveis, FKs e índices. Nenhuma das sete linhas foi escrita ou modificada.
- O health check público da API publicada respondeu HTTP 200, mas não informa versão ou commit. A migration é aditiva e preserva campos/estados antigos; não foi possível atestar o commit exato publicado porque não há credencial Vercel disponível. O novo código local deve ser ativado após o schema e em deploy separado.
- A tentativa de listar os backups do Supabase Management API retornou HTTP 403: a identidade disponível não tem privilégio para essa consulta. Não foi criado nem baixado backup, nenhum restore foi tentado e não é possível afirmar que existe ponto recuperável. A documentação do Supabase indica que backups diários dependem do plano e são consultados em Database → Backups; PITR é uma opção de recuperação distinta. [Backups do Supabase](https://supabase.com/docs/guides/platform/backups).

**Gate para continuar:** o proprietário precisa confirmar no Dashboard o projeto/ref, um backup concluído/restaurável (ou PITR com janela e ponto de recuperação válido) e a capacidade operacional de restaurar. Depois, precisa autorizar explicitamente a aplicação de `20261027150000_expense_workflow` nesse projeto ciente de Production/Preview. Sem essas duas confirmações, a aplicação permanece bloqueada.

## Preservação e inspeção somente leitura

O checkout foi preservado, incluindo as alterações rastreadas e não rastreadas que já existiam. O HEAD de referência permanece `919a5accc91bc96dbd87773411668d017f968e35`. Nenhum reset, migration, deploy, atualização geral ou exclusão foi feito.

A inspeção somente leitura do PostgreSQL Supabase atual confirmou PostgreSQL 17.11. O enum `ExpenseStatus` ainda contém `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `PAID` e `CANCELLED`; ainda não contém `REJECTED`. As colunas novas desta alteração não existem. Os índices atuais de organização/status/vencimento, organização/cliente e organização/processo continuam presentes.

Há sete despesas preexistentes, todas `DRAFT`, em BRL; seis ainda não têm vencimento. Nenhuma foi alterada. Novos cadastros exigem vencimento; para preservar registros antigos, a API permite sua leitura e impede sua confirmação enquanto a data estiver ausente. Um usuário autorizado precisa editar cada despesa legada que queira encaminhar e informar a data.

Foram observadas 41 organizações sem a chave `expenseApprovalRequired` configurada explicitamente. A regra em código é exigir aprovação quando a configuração não existe. Não foi feita atualização em massa. Escritórios com um único administrador/aprovador podem desativar a aprovação, por ação explícita de administrador, ou incluir outro aprovador ativo. A submissão com aprovação obrigatória fica bloqueada quando não há outro membro ativo autorizado; o registro permanece em rascunho.

O histórico Supabase observado contém migrations até `20261022213000_document_signing`; o projeto usa `supabase/migrations` e `supabase db push --linked` como caminho de aplicação. Não existe `_prisma_migrations` neste banco. A pasta Prisma da migration é referência pareada para o schema, não o caminho de aplicação deste projeto.

## Revisão do SQL pendente

Os arquivos abaixo contêm SQL idêntico (SHA-256 `3F94E03D5137EE79A9A45088AB458ABCBCB441A2751AD89C4BF60F378D71EA4`):

- `supabase/migrations/20261027150000_expense_workflow.sql` — origem usada pelo Supabase CLI.
- `packages/db/prisma/migrations/20261027150000_expense_workflow/migration.sql` — cópia Prisma correspondente.

```sql
BEGIN;

ALTER TYPE public."ExpenseStatus" ADD VALUE IF NOT EXISTS 'REJECTED' BEFORE 'PAID';

ALTER TABLE public."expenses"
  ADD COLUMN IF NOT EXISTS "responsible_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "rejected_by_id" UUID,
  ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "rejection_reason" VARCHAR(500);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.expenses'::regclass
       AND conname = 'expenses_responsible_user_id_fkey'
  ) THEN
    ALTER TABLE public."expenses"
      ADD CONSTRAINT "expenses_responsible_user_id_fkey"
      FOREIGN KEY ("responsible_user_id") REFERENCES public."users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.expenses'::regclass
       AND conname = 'expenses_rejected_by_id_fkey'
  ) THEN
    ALTER TABLE public."expenses"
      ADD CONSTRAINT "expenses_rejected_by_id_fkey"
      FOREIGN KEY ("rejected_by_id") REFERENCES public."users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "expenses_organization_id_status_paid_at_idx"
  ON public."expenses"("organization_id", "status", "paid_at");
CREATE INDEX IF NOT EXISTS "expenses_organization_id_responsible_user_id_status_idx"
  ON public."expenses"("organization_id", "responsible_user_id", "status");

COMMIT;
```

### Compatibilidade, efeitos e recuperação

- `REJECTED` é inserido antes de `PAID`, alinhado à ordem declarada no enum Prisma. A alteração do enum não modifica valores das linhas existentes. A migration não depende do novo valor antes do `COMMIT`.
- Os cinco campos novos são anuláveis e não têm default. Despesas existentes permanecem nos mesmos estados e valores; os campos novos ficam `NULL`. Não há backfill nem obrigação de associar responsável a registros antigos.
- O código novo depende dessas colunas e do enum atualizado. Não o ativar antes da migration; a ordem de rollout é migration aprovada primeiro, deploy do código depois, em autorização separada.
- As FKs usam `ON DELETE RESTRICT ON UPDATE CASCADE`. Como os campos são novos e anuláveis, os registros existentes não contêm referências a validar. Os dois índices correspondem aos índices Prisma do resumo de pagas e da lista por responsável. O índice de vencimento já existe.
- A transação explícita torna a sequência DDL atômica: se uma instrução falhar antes do commit, confirmar que os objetos foram revertidos e que a migration não entrou no histórico. O tamanho atual observado da tabela é pequeno; ainda assim, adicionar FKs e criar índices pode bloquear escritas enquanto os locks são mantidos. Aplicar em janela de baixo tráfego.
- Após o `COMMIT`, remover `REJECTED` não é rollback trivial. Se a migration já tiver sido aplicada, prefira correção futura para frente. Se a execução tiver sido commitada mas não registrada no histórico por falha posterior, inspecione enum, colunas, constraints e índices antes de qualquer reexecução ou reparo de metadados; o SQL é idempotente para os objetos listados, mas não se deve marcar a migration manualmente sem verificar o estado real.
- A documentação oficial do PostgreSQL 17 permite adicionar o rótulo do enum em transação, mas não permite usar o rótulo novo até a transação terminar. Por isso a migration apenas o torna disponível para operações posteriores ao commit. [PostgreSQL: `ALTER TYPE`](https://www.postgresql.org/docs/17/sql-altertype.html).

## Regras de negócio e ciclo final

| Configuração da organização                             | Fluxo                                                        | Regra decisiva                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Aprovação desabilitada                                  | Criar → confirmar despesa → pagar integralmente              | A confirmação muda para `APPROVED`; não registra um falso aprovador.                                    |
| Aprovação habilitada (padrão para configuração ausente) | Criar → submeter → aprovar ou rejeitar → pagar integralmente | O criador não pode aprovar a própria despesa. A submissão bloqueia se não houver outro aprovador ativo. |

Pagamento aceita somente valor Decimal igual ao total da despesa e somente no estado `APPROVED`. O bloqueio transacional da linha serializa duas tentativas de pagamento; a primeira muda o estado para `PAID`, e a seguinte encontra estado inválido. A despesa guarda sua moeda e os relatórios agrupam por moeda, sem somar moedas distintas. Cancelamento não é permitido após pagamento. Transições e ator são registrados em `AuditLog` na mesma transação.

O endpoint novo `GET /finance/expenses/:id/history` pagina a auditoria dentro do escopo de organização e, para perfil de cliente, do `clientId`. Retorna ator, horário, ação/transição e nomes de campos alterados, sem expor valores anteriores ou posteriores da auditoria. A lista da API só inclui títulos de comprovantes para `documents:view`; no portal, limita ainda a documentos `CLIENT` do próprio cliente. A URL assinada de download continua sujeita à autorização existente do módulo de documentos.

Resumo e relatórios mantêm distinção entre:

- despesas `APPROVED` previstas e aguardando pagamento;
- despesas `PENDING_APPROVAL`, reportadas em separado e não subtraídas como despesa já aprovada na projeção;
- despesas `PAID`, incluídas no caixa efetivo pela data de pagamento;
- receitas efetivamente recebidas, calculadas apenas de pagamentos confirmados.

Pagamento parcial, estorno de despesa, reembolso processado e conciliação permanecem indisponíveis. `reimbursable` continua sendo somente um sinalizador informativo; não cria receita ou recebível. A forma e referência do pagamento aparecem na auditoria, não em um livro auxiliar independente.

## Interface revisada

A tela existente permite criar e editar rascunhos/rejeitadas, definir vencimento, categoria, valor, moeda, responsável e vínculo opcional com cliente/processo; submeter, aprovar/rejeitar, pagar integralmente, cancelar, anexar e abrir comprovantes, consultar histórico e filtrar por data/categoria/status. O resumo separa moeda, aguardando aprovação, aguardando pagamento, vencidas e pagas.

Quando a política de aprovação não está carregada, a ação de confirmação fica desabilitada. Se a política exigir aprovação mas não houver aprovador independente, o painel explica como o administrador pode resolver o impasse. Mudanças de política não mudam silenciosamente despesas já pendentes. Erros, sucesso e confirmação de quitação exibem mensagens explícitas.

## Validação local

- `npm test`: **182 testes passaram** — API 136, web 29, shared 17.
- `npm run lint`: passou sem avisos.
- `npm run format:check`: passou.
- `npm run typecheck`: passou.
- `npm run db:format`, `npm run db:validate` e `npm run db:generate`: passaram.
- `npm run build`: API, UI e Next.js passaram.
- Testes focados no ciclo: API schemas/serviço (37) e interface da política de aprovação (4) passaram.

As evidências locais cobrem oficina com único aprovador, bloqueio de autoaprovação, fluxo sem aprovação, vencimento ausente em despesa legada, rejeição, pagamento exato/parcial recusado, concorrência, transição inválida, isolamento, histórico sem valores e visibilidade de comprovantes. Testes existentes de relatórios mantêm os valores `Decimal`, moedas separadas, caixa pago e previsão. Nenhuma escrita remota foi executada.

**Ainda não comprovado:** execução HTTP autenticada das rotas de despesa, criação/aprovação/pagamento no PostgreSQL com o novo schema, anexos e URLs assinadas pela interface, RLS/isolamento real do fluxo de despesas após a migration e relatório integrado com despesas pagas. Não se deve classificar o módulo completo como operacional até isso ser validado após aplicação aprovada.

## Procedimento recomendado após aprovação

1. O proprietário deve autorizar especificamente a migration `20261027150000_expense_workflow` no projeto Supabase atual, confirmando que aceita o vínculo existente com Vercel Production/Preview. Autorizações antigas de dados QA sintéticos não autorizam esta alteração de schema.
2. Confirmar novamente o projeto/ref no Dashboard, identidade de PostgreSQL/Auth/Storage e o ambiente Vercel; confirmar que PITR/backup recente está disponível e que não há outra migration pendente. A confirmação deve vir de membro com privilégio de leitura dos backups; a API consultada nesta execução negou acesso (403).
3. Conferir `supabase migration list` e repetir o dry-run usando a conexão direta já validada. Nesta execução, `--linked` não funcionou porque o checkout não tem ref Supabase vinculada; o dry-run por `--db-url DIRECT_URL` listou somente a migration esperada. Se a ref for vinculada localmente para usar o atalho do repositório, comparar a ref antes de qualquer execução.
4. No shell de aplicação, classificar o destino como protegido/production-connected para que o guardrail exija autorização adicional (`SUPABASE_ENVIRONMENT=production`, `ALLOW_PRODUCTION_MIGRATION=true`) e exigir `SUPABASE_PROJECT_REF` igual a `CONFIRM_SUPABASE_PROJECT_REF`; não gravar valores secretos no relatório. Usar o caminho do projeto, `npm run db:migrate:deploy`, que chama o safeguard e `supabase db push --linked`. Não usar `prisma migrate deploy` neste projeto.
5. Verificar que a migration apareceu uma única vez no histórico Supabase e comparar enum, cinco colunas, duas FKs e dois índices com o SQL. Rodar `npm run db:validate` e `npm run db:generate`.
6. Com autorização de escrita sintética previamente confirmada, executar um smoke test por HTTP/JWT: escritório com aprovação desabilitada; escritório com dois aprovadores; bloqueio de autoaprovação; aprovação/rejeição; pagamento integral; duplicidade/concorrência; documento interno; leitura de histórico; filtro e relatório. Usar IDs sintéticos rastreáveis e limpar somente esses registros segundo a política de retenção existente.
7. Considerar deploy do código em etapa separada, com autorização própria. Confirmar erro zero no servidor e que overview/caixa mostram despesas pagas apenas uma vez e previsões não são apresentadas como caixa efetivo.

## Arquivos modificados nesta missão

- `apps/api/src/finance/finance.controller.ts`
- `apps/api/src/finance/finance.schemas.ts`
- `apps/api/src/finance/finance.schemas.test.ts`
- `apps/api/src/finance/finance.service.ts`
- `apps/api/src/finance/finance.service.test.ts`
- `apps/web/features/finance/finance-operations.tsx`
- `apps/web/features/finance/expense-workflow.ts`
- `apps/web/features/finance/expense-workflow.test.ts`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20261027150000_expense_workflow/migration.sql`
- `supabase/migrations/20261027150000_expense_workflow.sql`
- `PROJECT_CONTEXT.md`
- `docs/auditoria-2026-10-27/REVISAO_FINALIZACAO_DESPESAS.md`
