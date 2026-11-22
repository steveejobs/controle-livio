# Etapa 6.10 — publicação e homologação

**Quality completo PASS (4/4). Recovery FAIL: 57/58 contratos PASS. DEF-007 permanece aberto. Production NO-GO.** Uma publicação autorizada foi realizada; nenhum segundo commit/push, rerun, workflow manual, merge ou deploy.

## Publicação e preflight

Worktree exclusivo: `C:\Users\jarde\Documents\GitHub\controle-livio-audit-stage2-validation-20261104`. Branch validation/audit-stage2-20261104. HEAD anterior `ce45d27c11e92421e8a8b7d669e251a01c74c19e`; novo SHA remoto `33e760c204ea2ced6c0ec42368b63dc8cd6dc26d`. PR #3 permanece OPEN/draft/sem merge. Os outros worktrees e conflitos foram preservados.

Os sete arquivos exatos do manifesto6.9 foram adicionados explicitamente. Índice inicialmente vazio; diff staged binário idêntico ao patch, blobs e tree conferidos antes do único commit/push. Documentos, logs, evidências, produto, migrations, policies e regras financeiras ficaram fora do commit. Tree publicada `f72df81aaae532c9b77029764f6486dd0028bbd2`. Patch SHA-256 `275456b7fb267fbf124574e19e34af6eb8d7e31c4c035b65fc68b5c3284472a4`. [Manifesto qualificado](MANIFESTO_ETAPA6_9.json) contém hashes locais/LF/blobs e configuração efetiva de EOL.

Replay físico independente sobre archive do HEAD reproduziu os mesmos blobs e tree. core.autocrlf=true pode converter arquivos da cópia para CRLF; isso foi distinguido dos bytes LF dos blobs. CRLF legado de restore-local-ci foi preservado sem renormalização/configuração global. [Pré-publicação](../../test-results/etapa610/prepublication.json) e [staging](../../test-results/etapa610/staging.json).

| Arquivo                                        | Git blob ID                              | SHA-256 dos bytes do blob                                        |
| ---------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| tools/qa/restore-local-ci.mjs                  | a65f93f8f9d3fd08f3b0c8822e7fd4e300d98d0f | cb91f3af6617bbf970dbb9d72e4fe687ba8c4ac607eba9aa1069e32398911451 |
| tools/qa/restore-session-proof.mjs             | 82d91baf6a6202b72ab3a084ad567d23ed53b7fe | 7b6e5c73e3e04726b506460f3676fa399df9e519c87ad45d3ee077bf89caae59 |
| tools/qa/document-security.test.mjs            | e88134cb3e767bbc74953f090148cf46a311ab33 | 397abfedd553e093c921a448a824a2859afa415b2f67809e0f2b54cacc498d12 |
| tools/storage/recovery/coordinated-restore.mjs | 772552206d29b035a79ae14a513214ba97e14dec | 4822645661de05c967df9a85cac66d71a1b63fc19e1d4bcc014c6e9d521ff330 |
| tools/storage/recovery/restore-diagnostics.mjs | 575f0b8f02b507406dc015c45ae18bb118176aad | 4305fe590e20754d75876cc95c01d5e12875fe30e9da4e243a3a93973969215b |
| tools/storage/recovery/qualification.test.mjs  | c9f125ce349953e8411cff236e6c4036cd5ccf38 | 93c35895cdf2cbae137e169cf0a106fc494eb8f43546684f2c6b03596213f072 |
| tools/storage/recovery/sql-probe.mjs           | d2f5336d92c12acbf97009595e3c116aa57ac1b2 | a4ea1e6bcb2e7edd6b2e06ed0b0f4a8f8a028a969ffa87d8678cfb9d3dcac6d1 |

Preflight6.9 reconferido, não substituído por números históricos:433 Vitest,198 Node,42 Playwright/API simulada,35 PGlite,17 gates exit0. Os hashes de logs e fontes correspondem exatamente à árvore publicada; nenhum fonte mudou depois dos testes. O npm ci era novo na cópia limpa; builds/tipos/lint/format/Prisma/sintaxe/YAML/diff/replay estavam concluídos. Não houve repetição desnecessária das suítes. As tentativas de verificação adicionais corrigiram somente CWD do replay, distinção de EOL e falso positivo da fixture redaction external.invalid; nenhum código da candidata mudou.

Bloqueios Vercel de API/web para esta branch continuam false, flags gerais de dispatch/delete têm default false. Somente o workflow descartável existente ativa flags em seu próprio processo, com guards Linux/GitHubActions/loopback/project_id/cluster/volume. Nenhuma configuração cloud foi consultada ou alterada. Executor local teve interrupções durante consultas; logs/artefatos já concluídos foram recuperados sem repetir publicação ou workflows.

## Workflows e SHA real

[Quality PR 44161016548](https://github.com/steveejobs/controle-livio/actions/runs/44161016548) PASS. [Recovery 44161016551](https://github.com/steveejobs/controle-livio/actions/runs/44161016551) FAIL. Ambos evento pull_request/tentativa1. Checkout real nos cinco jobs: `92adf7ba3c18ce60a72d057453ead2967aff5816`, confirmado nos logs e JSONs de Recovery/OCR/financeiro. O headSha da API GitHub aponta o commit publicado; é distinto do merge realmente testado. [Provas dos checkouts](../../test-results/etapa610/tested-shas.json).

| Job                | Resultado                | Execução observada                                                                                                |
| ------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| application        | PASS                     | Formato/lint/tipos/Vitest/Prisma/builds/runtime OCR/bundle/Playwright local concluídos.                           |
| synthetic-restore  | PASS no escopo sintético | pg_dump/TOC/pg_restore, sessão efetiva, owners/grants/ACLs, FKs,64 CHECKs e dados; estado operacional INCOMPLETE. |
| financial-security | PASS                     | 312 casos/216 negativas, scanner real, Auth/RLS/Storage/recibos.                                                  |
| supabase-isolation | PASS                     | 64 negativas documentais,DEF-01810/17,OCR real201/409,navegador focused/full sem skipped/flaky/unexpected.        |
| recovery-contracts | FAIL                     | 57 contratos PASS; X18 bloqueado antes de DATA_RESTORE_STARTED por diferença estrutural de catálogo.              |

Quality push44161004111 aprovou application e ignorou três jobs: não foi utilizado como homologação completa. Nenhum rerun manual.

## Restore sintético aprovado e seus limites

O novo ensaio chegou a stage complete:50 tabelas,0 sequências no recorte sintético, pg_restore com exit-on-error, quatro sessões de papel com três observações JSON e RESET comprovado. Owners públicos, grants/default ACLs e FKs conferidos;64 CHECKs na origem e64restaurados passaram pela comparação canônica restrita e pelos metadados, incluindo as nove previamente problemáticas. Asserções de estrutura/RLS/FORCE RLS/funções/triggers, acesso de servidor e barreiras de papéis comuns permanecem no executor; nenhum owner/grant/CHECK foi relaxado.

Relatório original [restore-rehearsal.json](../../test-results/etapa610/ci-44161016548/artifacts/synthetic-restore-evidence/restore-rehearsal.json) mantém **status INCOMPLETE**, mesmo com job PASS: schema/extensões/jobs/ACLs de scheduler foram excluídos deliberadamente e listados no TOC; Storage físico, configuração Auth hospedada, SMTP e segredos externos não são restaurados por esse ensaio. Não confundir este resultado com REC-X18 completo ou recuperação universal de produção.

## REC-X18: primeira falha agora comprovada

[Diagnóstico específico](../../test-results/etapa610/diagnostico-rec-x18.json). O último estágio de domínio aprovado foi TARGET_MIGRATED; falhou TARGET_SCHEMA_VERIFIED, comando lógico catalog.compare-before-data-restore, PID 10146. AssertionError/ERR_ASSERTION em coordinated-restore.mjs:547:12: “Migrations, owners, grants, RLS and functions must match before data restore”. Não houve erro de subprocesso nessa asserção; exit/signal/SQLSTATE são null, não inventados a partir do exit1 do job.

Backup concluído: 85 tabelas,1 sequência e66 arquivos físicos da origem; archive SHA-256 `e5125616fe0fd507abf35543b71a391ebd768534d91616817de4c681f85f6fdf`. Destino independente livio-recovery-44161016551-d59e5a17, cluster7709229791400251431, distinto da origem 7709228217122766887; volumes/containers distintos e backend/mounts verificados. Migrations do destino concluíram. Isso não equivale à restauração.

Catálogos exportados antes da asserção demonstram exatamente estas diferenças:

| Grupo                                   | Apenas na origem     | Apenas no destino |
| --------------------------------------- | -------------------- | ----------------- |
| relations_owners_acl_rls                | `supabase_migrations | seed_files        | r               | postgres                  |            | f      | f`<br>`supabase_migrations | seed_files_pkey | i    | postgres |        | f   | f`  | nenhum |
| column_acl                              | `supabase_migrations | seed_files        | path            | `<br>`supabase_migrations | seed_files | hash   | `<br>`supabase_migrations  | seed_files_pkey | path | `        | nenhum |
| non_public_checks_and_other_constraints | `supabase_migrations | seed_files        | seed_files_pkey | PRIMARY KEY (path)        | t`         | nenhum |

Os outros dez grupos, incluindo funções, policies, roles, default ACLs, triggers e64CHECKs públicos, têm hashes iguais. Trata-se de discrepância real de schema de metadados do CLI, não de mera formatação nem de owner/grant ampliado. O bootstrap da origem aplica o seed configurado; coordinated-restore.mjs:460 desabilita db.seed no scratch e copia somente migrations antes do reset do destino. A tabela/índice/PK seed_files presentes na origem não são criados nesse destino. Esta cadeia de configuração e o catálogo comprovam o bloqueio do harness; o comportamento exato do CLI que cria o metadado deverá integrar a regressão da próxima correção. Não é evidência de falha dos escritores/reconciliador nem de perda documental.

A instrumentação cumpriu seu objetivo: registrou mensagem/linha, último estágio aprovado, estágio/comando falho, PID, identidades, catálogo nominal/diferenças e causa principal antes do cleanup. captureErrors e cleanupErrors vazios. O probe opcional da origem já parada retornou UNAVAILABLE/TypeError de inspeção de Labels; é uma limitação secundária do diagnóstico, não a falha primária. O destino estava running na captura.

**Não executados:** restore dos dados PostgreSQL, cópia de Storage para o destino, verificação pós-restore, retomada por processo novo e integridade final pós-retomada. O crash de fixture antes do backup e a existência de66arquivos na origem não substituem essas provas.

Proposta mínima local, sem implementação/publicação: alinhar explicitamente o schema de metadados seed_files na preparação/restauração do destino identificado com o schema da origem/backup, preservando owner/PK/ACLs e dados. Não excluir a tabela da comparação, não ignorar hashes e não habilitar seed de negócio indiscriminadamente. Qualificar a alternativa com a versão instalada do CLI e controles negativos de objeto ausente/owner/PK alterados. Nenhuma mudança de produto ou migration está justificada por esta evidência. Correção exige revisão/autorização própria.

## Matriz DEF-007 e pós-condições

[MATRIZ_DEF007_ETAPA6_10.csv](MATRIZ_DEF007_ETAPA6_10.csv) contém58IDs únicos e os snapshots SQL/Storage, bucket/chave/organização, eventos/auditoria, PIDs, falha injetada, estágio e evidência original completa sanitizada quando disponível. NOT_RECORDED identifica ausência de campo, não execução presumida. X18 mantém FAIL e seus subestágios não executados são explícitos.

| Grupo   | PASS | FAIL |
| ------- | ---: | ---: |
| REC-W01 |    8 |    0 |
| REC-W02 |    8 |    0 |
| REC-W03 |    8 |    0 |
| REC-W04 |    8 |    0 |
| REC-W05 |    8 |    0 |
| REC-X   |   17 |    1 |

W01 documento inicial,W02 versão,W03 foto,W04 assinatura,W05PDF:40/40 novos PASS. Cinco crashes F05 com SIGKILL e processo recuperador distinto, cinco F07 com objeto/hash físico após timeout e recuperação independente. F07 prova encaminhamento tardio pelo proxy após timeout do cliente, não processamento interno pré-aceito pelo fornecedor. X05 histórico/soft delete/legal hold PASS;X10 sequência administrativa completa PASS;X16/REC-C01 comprovantes PASS.

Concorrência X01: 5 medições de transação, espera máxima0.7010219999938272ms, duração máxima3.9485179999901447ms,18 observações de I/O externo sem transação aberta. Workers independentes, leases/fences e interrupções constam no JSON. Não há prova universal de ausência de concorrência fora do recorte.

| Contrato    | Resultado | Estágio                                                            |
| ----------- | --------- | ------------------------------------------------------------------ |
| REC-W01-F01 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W01-F02 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W01-F03 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W01-F04 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W01-F05 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W01-F06 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W01-F07 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W01-F08 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W02-F01 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W02-F02 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W02-F03 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W02-F04 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W02-F05 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W02-F06 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W02-F07 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W02-F08 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W03-F01 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W03-F02 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W03-F03 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W03-F04 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W03-F05 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W03-F06 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W03-F07 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W03-F08 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W04-F01 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W04-F02 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W04-F03 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W04-F04 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W04-F05 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W04-F06 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W04-F07 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W04-F08 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W05-F01 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W05-F02 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W05-F03 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W05-F04 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W05-F05 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W05-F06 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W05-F07 | PASS      | Pós-condições do contrato concluídas                               |
| REC-W05-F08 | PASS      | Pós-condições do contrato concluídas                               |
| REC-X01     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X02     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X03     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X04     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X05     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X06     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X07     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X08     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X09     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X10     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X11     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X12     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X13     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X14     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X15     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X16     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X17     | PASS      | Pós-condições do contrato concluídas                               |
| REC-X18     | FAIL      | FAIL TARGET_SCHEMA_VERIFIED; dados/Storage/retomada não executados |

## Regressões reais desta publicação

Financeiro312/312 e216negativas PASS; pagamentos/estornos/despesas/concorrência/rollback/relatórios/auditoria permanecem com seus cenários. Storage72planejadas:64operações enviadas,64PASS,zeroFAIL;oito copy-existing NOT_EXECUTED justificadas por KeyAlreadyExists em controle, sem contagem fictícia. Relinks e consumidor SDK executaram barreiras/snapshots; bytes/hashes/vínculos/versões preservados. DEF-018 dez casos e17 conjuntos de probes PASS, sem promoção de Cliente sem vínculo.

OCR real PASS: imagem sintética/Tesseract/texto/parser/revisão/API201/PostgreSQL/documento/hash/reabertura/duplicidade HTTP409. Antes/depois da duplicidade:clientes3/3;documentos1/1;versõesundefined/undefined;objetosundefined/undefined. Cadastro original, histórico/auditoria e hash preservados pelo contrato. Nenhuma abrangência nova para PDF de identidade/câmera física/autenticidade é declarada.

## Infraestrutura, evidências e cleanup

Runners descartáveis separados, PostgreSQL/Auth/PostgREST/Storage,ClamAV real,qpdf validado,API real e navegador conforme workflows existentes. Identidades/imagens/volumes e diagnósticos de dependências estão nos JSONs sanitizados; dumps e bytes de documentos não foram exportados ao relatório. [Índice de artefatos Quality](../../test-results/etapa610/ci-44161016548/artifacts-downloaded.json) e [Recovery](../../test-results/etapa610/ci-44161016551/artifacts-downloaded.json) registram hashes originais/sanitizados. Logs públicos usados para checkout foram sanitizados no coletor local; downloads privados ficam fora dos entregáveis.

Destino X18: cleanup separado ABSENT_VERIFIED,zero containers e zero volumes nomeados do projeto. Stop interno bem-sucedido não foi usado isoladamente como prova física. Origem Recovery/financeira têm diagnóstico de containers e exit do stop; não há inventário universal de todos os volumes/órfãos. Cleanup de Supabase no job integrado e sintético usa ||true no workflow existente: ausência física independente nesses dois jobs não deve ser inferida do verde. Nenhum recurso compartilhado/Production/Preview foi acessado ou alterado.

## Classificação

| Item                         | Resultado    | Evidência e limite                                                                                                                                                                                |
| ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SYNTHETIC_RESTORE            | PASS         | Job aprovado no escopo sintético: pg_restore, sessão efetiva, owners/grants, FKs e 64 CHECKs comparados. Relatório operacional continua INCOMPLETE.                                               |
| REC_X18_FAILURE_DIAGNOSTICS  | PASS         | Erro/linha/checkpoint preservados antes de cleanup; três diferenças nominais identificam seed_files ausente no destino. Probe secundário da origem parada ficou UNAVAILABLE sem mascarar a causa. |
| REC_X18_DATABASE_RESTORE     | NOT_EXECUTED | Barreira de catálogo falhou antes de DATA_RESTORE_STARTED; backup não equivale a restore.                                                                                                         |
| REC_X18_STORAGE_RESTORE      | NOT_EXECUTED | 66 objetos físicos exportados na origem; não foram restaurados no destino.                                                                                                                        |
| REC_X18_RECOVERY_RESUMPTION  | NOT_EXECUTED | Nenhuma retomada posterior a restore; crash da fixture não substitui essa prova.                                                                                                                  |
| REC_X18_CLEANUP              | PASS         | Destino ABSENT_VERIFIED: zero containers e volumes nomeados do projeto; sem cleanupErrors.                                                                                                        |
| DEF007_WRITER_COVERAGE       | PASS         | W01–W05 8/8 cada, quarenta pós-condições concluídas nesta execução.                                                                                                                               |
| DEF007_TRANSVERSAL_COVERAGE  | PARTIAL      | 17/18 PASS; REC-X18 FAIL antes da restauração.                                                                                                                                                    |
| DEF007_INTEGRATED_MATRIX     | FAIL         | 58 IDs avaliados: 57 PASS e X18 FAIL; suas fases de restore não executaram.                                                                                                                       |
| FINANCIAL_REGRESSION         | PASS         | 312 casos e 216 negativas na nova execução; job financeiro PASS.                                                                                                                                  |
| DOCUMENT_SECURITY_REGRESSION | PASS         | 64 negativas reais PASS; oito copy-existing NOT_EXECUTED justificadas separadamente.                                                                                                              |
| OCR_REGRESSION               | PASS         | Tesseract/revisão/API/PostgreSQL/documento/hash/reabertura/409 aprovados nesta execução.                                                                                                          |
| QUALITY_ALL_JOBS             | PASS         | Quatro jobs da PR aprovados no merge testado; push com três skipped não utilizado como homologação.                                                                                               |
| CI_STORAGE_RECOVERY_WORKFLOW | FAIL         | recovery-contracts falhou no gate pré-restore de X18; cleanup e coleta concluíram.                                                                                                                |
| OPERATIONAL_RESTORE          | PARTIAL      | INCOMPLETE: ensaio sintético exclui scheduler, Storage e configuração Auth/segredos hospedados. X18 completo continua pendente.                                                                   |
| PRODUCTION_GO_NO_GO          | BLOCKED      | NO-GO; DEF-007 ainda aberto e sem autorização de ativação hospedada/comercial.                                                                                                                    |

## Estado final

Uma publicação concluída, autorização consumida. PR draft preservada; nenhum código foi alterado após o push. Nenhum segundo commit/push,rerun,workflow manual,merge,deploy,migration hospedada ou ativação de worker/exclusões hospedadas. **DEF-007 não homologado integralmente.** Próxima ação: revisão específica do bootstrap do metadado seed_files no REC-X18; só depois nova publicação autorizada e matriz completa. Recuperação operacional hospedada e liberação comercial permanecem separadas.
