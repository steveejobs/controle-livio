# Aplicação autorizada da migration de despesas e QA — 2026-10-28

## Resultado

- **MIGRATION_APPLIED: YES** — aplicada exclusivamente `20261027150000_expense_workflow` no Supabase `ioebcdpyrszokdyaoaqv`, após autorização explícita do proprietário.
- **MIGRATION_POSTCHECK: PASS** — enum, cinco colunas, duas FKs, dois índices e histórico verificados; dry-run posterior informou `upToDate: true`, sem migrations, seeds ou roles pendentes.
- **PREEXISTING_EXPENSES: PASS** — as sete despesas existentes foram preservadas, com o mesmo hash dos campos originais antes/depois da migration e depois dos testes.
- **EXPENSES_HTTP_QA: PASS** — nove verificações sintéticas passaram pela API local, com JWTs Supabase de usuários QA.
- **DEPLOY: NOT_DONE** — nenhum deploy foi autorizado ou realizado.
- **RESTORE_TEST: NOT_TESTED** — o proprietário aceitou explicitamente esse risco residual.

O banco está conectado aos ambientes Vercel Production/Preview. A migration alterou schema nesse projeto compartilhado; o código não foi publicado.

## Autorização, destino e backup

O proprietário autorizou somente a migration nomeada e reconheceu que o backup não teve restauração testada e não cobre Auth ou Storage. Antes da aplicação, confirmei novamente:

- Auth/API: host `ioebcdpyrszokdyaoaqv.supabase.co`.
- PostgreSQL: database `postgres`, PostgreSQL 17.11, sessão Supavisor na porta 5432 e usuário/host correspondentes à ref autorizada.
- Storage: mesmo projeto Supabase; no preflight QA os três buckets da aplicação estavam privados.
- O SQL de `supabase/migrations` e seu par Prisma tinham o mesmo SHA-256: `3F94E03D5137EE79A9A45088AB458ABCBCB441A2751AD89C4BF60F378D71EA4E`.
- O arquivo de backup continuava com 735.578 bytes e SHA-256 `99952799a4bcb6ed18827199760812d2be9fffc4cd38c6f51296ead26e7ec1f2`; `pg_restore --list` retornou código 0.

O Supabase CLI oficial, precedido pelo safeguard do repositório e apontado ao `DIRECT_URL` de sessão validado, fez um dry-run imediatamente antes da aplicação. Ele listou exclusivamente `20261027150000_expense_workflow.sql`, com `seeds: []` e `roles: []`. A aplicação retornou `dryRun: false` e apenas essa migration. A checagem posterior retornou `upToDate: true` e lista vazia. Nenhum outro comando de migration, seed, reset ou deploy foi executado.

O backup continua sendo apenas do schema e dados `public`. Não inclui Auth, Storage/objetos, roles globais, configuração Supabase/Vercel ou arquivos armazenados. A integridade estrutural não prova recuperação ponta a ponta.

## Schema após a migration

- `public."ExpenseStatus"`: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `PAID`, `CANCELLED`.
- Colunas novas anuláveis, sem defaults: `responsible_user_id UUID`, `submitted_at TIMESTAMPTZ(3)`, `rejected_by_id UUID`, `rejected_at TIMESTAMPTZ(3)` e `rejection_reason VARCHAR(500)`.
- FKs `expenses_responsible_user_id_fkey` e `expenses_rejected_by_id_fkey`: `ON DELETE RESTRICT`, `ON UPDATE CASCADE`, para `users(id)`.
- Índices: `expenses_organization_id_status_paid_at_idx` e `expenses_organization_id_responsible_user_id_status_idx`.
- Histórico remoto: 17 migrations; `20261027150000` aparece uma vez e é a versão mais recente.

As sete despesas do snapshot pré-migration continuam `DRAFT`/BRL; seis não têm vencimento. SHA-256 das linhas, serializadas como JSONB canônico sobre os campos originais: `2a02abed87db1766f30c3dcd1988896d3c5272f3f604bd18dc53b44f90b01cee`. A comparação posterior excluiu somente os cinco campos novos, que não existiam no snapshot e foram adicionados sem valor. A verificação repetida depois do QA filtrou as linhas por data de criação anterior ao snapshot e obteve novamente sete linhas e o mesmo hash.

## Preflight e contenção de efeitos

O preflight da execução de despesas confirmou ref e destinos, cadastro público de Auth desativado, ausência de credenciais de integrações externas detectadas pelo harness, zero inscrições push, três buckets privados e RLS habilitada/forçada em 13/13 tabelas da matriz. O job de notificações estava ativo; não foi alterado. O smoke test não criou tarefas, lembretes nem notificações e não chamou integrações financeiras externas.

As chamadas de negócio foram feitas com JWTs obtidos pelo login Supabase dos perfis sintéticos. A service-role foi usada apenas pelo harness no servidor para provisionar e suspender contas Auth QA; não foi usada para simular as permissões HTTP de administrador ou financeiro. A prova de isolamento cobre as guards/consultas da API autenticada. A execução não abriu uma sessão PostgreSQL com role `authenticated`; portanto não constitui teste direto da avaliação de policies RLS por esse role.

## Resultados do QA integrado de despesas

Run sintético: `1793200034677-b5a54e`. Organização primária e organização isolada foram criadas para este run; a primeira teve um perfil financeiro e um administrador aprovador, a segunda somente um administrador. O cliente, identidades, valores, descrições, comprovante e documentos eram sintéticos (`example.test`/PDF gerado no teste).

| Verificação                                 | Resultado | Evidência observada                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Política, padrão e permissões               | PASS      | Ausência de configuração exigiu aprovação; financeiro não alterou a política; administrador conseguiu configurá-la.                                                                                                                                                                     |
| Criar, editar e vencimento                  | PASS      | API gravou responsável, cliente, vencimento e valores `Decimal` exatos.                                                                                                                                                                                                                 |
| Aprovação desabilitada                      | PASS      | Envio confirmou diretamente como `APPROVED`; pagamento parcial foi recusado.                                                                                                                                                                                                            |
| Pagamento integral e idempotência de estado | PASS      | `125.1250` foi pago; duplicidade, cancelamento depois de pago e aprovação fora de estado foram recusados.                                                                                                                                                                               |
| Comprovante e URL assinada                  | PASS      | PDF QA foi enviado ao Storage privado; SHA-256/tamanho conferidos; URL do projeto expirava em 300 segundos; documento apareceu na lista autorizada.                                                                                                                                     |
| Aprovação obrigatória                       | PASS      | Estado `PENDING_APPROVAL`; autoaprovação bloqueada; pagamento antes da aprovação e rejeição sem motivo recusados; rejeição justificada, edição/reenvio, aprovação por outra identidade e pagamento `20.1000` concluídos.                                                                |
| Histórico                                   | PASS      | Transições `CONFIRM`, `PAY`, `REJECT`, `APPROVE` e pagamento final foram consultadas pela API.                                                                                                                                                                                          |
| Resumo e relatórios                         | PASS      | Total pago no escritório primário `145.2250 BRL`; previsto após pagamento `0.0000`; por cliente `145.2250`; pendente de aprovação não foi somado a despesas aprovadas. Durante aprovação pendente: `20.1000` foi reportado separadamente; após aprovação, a previsão mostrou `20.1000`. |
| Cancelamento e transições                   | PASS      | Rascunho foi cancelado; segundo cancelamento, envio e pagamento do cancelado foram recusados.                                                                                                                                                                                           |
| Isolamento multi-organização                | PASS      | Administrador de outro escritório recebeu lista/resumo próprios e `404` para histórico, alteração e documento do primeiro escritório.                                                                                                                                                   |
| Escritório com administrador único          | PASS      | Aprovação era obrigatória por padrão, `canSubmitForApproval=false`, envio bloqueado sem aprovador independente; o próprio administrador desabilitou a exigência e confirmou/pagou `9.9900`.                                                                                             |

Após o teste, as duas organizações QA deste run foram arquivadas; três memberships e usuários foram suspensos, três contas Auth foram banidas e perfis/auditoria/contadores QA foram retidos. O comprovante permanece no bucket privado, vinculado à organização sintética arquivada. Nenhum registro preexistente foi alterado ou apagado.

## Execução ampla e falha independente

Antes do run exclusivo de despesas, foi iniciada a verificação financeira mais ampla. O preflight passou, mas ela parou na etapa de leituras aquecidas do overview porque o teste exige que `x-ratelimit-remaining` diminua estritamente em cada chamada. A falha exata foi `O rate limit precisa contabilizar cada chamada autenticada.` Não diagnostiquei se a causa está no cabeçalho/contador ou na asserção QA; o overview não é declarado aprovado nesta execução.

Esse run falhou antes das despesas. Arquivou duas organizações QA, suspendeu três memberships/usuários e baniu três contas Auth. Criou somente cliente e recebível sintéticos antes da falha; não executou pagamento, upload ou notificação. Evidência: `test-results/qa-financial-http-1793199769444-118749.json`. Para desacoplar a jornada solicitada, o harness passou a oferecer `--expenses-only`; esse modo então concluiu as nove verificações acima. A primeira tentativa não alterou os sete registros antigos.

## Validações locais e limitações

- `npm run db:validate`: PASS.
- `npm run db:generate`: PASS.
- `npm run build:api`: PASS.
- TypeScript estrito e ESLint do harness QA: PASS.
- `npm run format:check`: PASS.
- QA HTTP/API/Prisma/Auth/Storage: PASS para os cenários listados; QA do overview no run amplo: FAIL pela asserção descrita.
- O frontend não foi exercitado em navegador conectado à API nesta etapa. Não houve deploy; o código Vercel Production/Preview não foi identificado/revalidado e deve ser publicado em etapa autorizada separada.
- Pagamento parcial, estorno, reembolso processado e conciliação continuam indisponíveis.
- O scheduler de notificações estava ativo e foi deixado inalterado. Embora a jornada não tenha criado notificações nem credenciais de envio/push estivessem configuradas, o preflight não prova que um item independente já enfileirado não foi processado pelo job durante o intervalo.
- `RESTORE_TEST: NOT_TESTED`; Auth/Storage não fazem parte do backup `public`.

## Artefatos e arquivos desta execução

- QA de despesas aprovado: `test-results/qa-financial-http-1793200034677-b5a54e.json` e `test-results/qa-financial-api-1793200034677-b5a54e.log`.
- Execução ampla interrompida: `test-results/qa-financial-http-1793199769444-118749.json` e `test-results/qa-financial-api-1793199769444-118749.log`.
- Verificações de schema/preservação fora do Git, no diretório protegido do backup: `post-migration-schema-verification-final.json` e `post-qa-preexisting-expenses-final.json`.
- Um arquivo intermediário `post-migration-schema-verification.json` naquele diretório registrou falso mismatch porque a primeira versão do verificador serializou JSONB pelo objeto JavaScript, em vez de comparar o texto canônico. A comparação correta foi executada depois e passou, com o hash acima. Esse intermediário não deve ser usado como evidência; a tentativa de removê-lo foi bloqueada pela política do shell, então ele permanece local no diretório protegido.
- Arquivos do repositório alterados/adicionados nesta etapa: `tools/qa/validate-financial-http.ts` (modo isolado e cenários HTTP de despesas), este relatório e `PROJECT_CONTEXT.md`. SQL de migration e schema Prisma não foram alterados nesta etapa.
