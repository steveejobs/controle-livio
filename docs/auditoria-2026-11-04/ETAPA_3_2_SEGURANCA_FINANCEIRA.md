> Atualizacao Etapa 3.3: este texto registra a candidata anterior. O estado atual, a ampliacao para dependencias/Storage/pais, as correcoes do harness e o pacote revisavel estao em [PREFLIGHT_CI_DEF008_ETAPA3_3.md](PREFLIGHT_CI_DEF008_ETAPA3_3.md) e VALIDACAO_ETAPA3_3.json. Os hashes/patch 3.2 sao historicos, conferidos antes das novas alteracoes. Nenhum PASS integrado novo.

# Etapa 3.2 ? seguran?a financeira

Data: 2026-11-11. Candidata local, ainda sem valida??o PostgreSQL. Production NO-GO.

## A. Estado e causa

Branch validation/audit-stage2-20261104, origem bc9bc30101e4c92a51eeb676375d40d927ea34f1. Conferidos local e GitHub somente leitura: PR #3 OPEN/draft, mesmo head; Quality 41887379143 failure. Checkout principal af41f4c em outra branch e com conflitos preservado. Sete documentos modificados e evid?ncias 3.1 sem tracking j? existiam na candidata e foram preservados.

Evid?ncia anterior: evidencias-etapa31/financial-stage3.json e ETAPA_3_1_FINANCEIRO_INTEGRADO.md. Financeiro alterou payments.status sem estorno/auditoria e expenses.status/paid_at sem aprova??o independente. Grants de 20260812150000 permitem DML authenticated; tenant_update verifica permiss?o granular, sem executar dom?nio. Trigger de pagamento n?o protege status. Migration 20261101100000 retira anon e privil?gios administrativos de authenticated, mas mant?m DML financeiro.

Outros caminhos economicamente equivalentes: inserir d?vida em receivables/parcelas, mudar contrato, inserir aloca??o/ajuste/estorno/renegocia??o, forjar solicita??o/recibo ou auditoria. Constraints/tenant/append-only s?o barreiras parciais, sem substituir transa??o de dom?nio.

Inspe??o est?tica: migrations oficiais n?o declaram views financeiras nem RPC de escrita financeira SECURITY DEFINER. Helpers SECURITY DEFINER de membership, permiss?o e download fazem consultas; handle_auth_user_profile ? trigger de Auth. Fun??es de integridade retornam trigger, n?o s?o RPC de neg?cio. N?o foram modificadas. Grants gerenciados, fun??es externas, memberships e objetos efetivos hospedados permanecem desconhecidos. tools/qa/financial-security-inspect.sql inventaria ACLs de tabela/coluna, defaults, memberships, policies permissivas/restritivas, views, fun??es/EXECUTE, triggers e constraints em preflight/postcheck. SQL preparado, ainda n?o executado.

Busca .from/.rpc no frontend n?o encontrou persist?ncia Supabase de dom?nio; consumidores financeiros usam API. Auth usa Supabase para identidade. PrismaService estende PrismaClient com DATABASE_URL, sem SET ROLE do JWT. O runner usa postgres com bypass; papel hospedado n?o foi consultado nem alterado. Jobs usam servi?os/Prisma; service_role continua restrito ao servidor para Auth/Storage. N?o houve aumento de privil?gio.

## B. Corre??o proposta

Migration supabase/migrations/20261111120000_financial_api_write_boundary.sql, posterior a recibos e restri??o p?blica. Revoga INSERT/UPDATE/DELETE de PUBLIC/anon/authenticated em 12 tabelas e grants INSERT/UPDATE por coluna. Adiciona policies RESTRICTIVE falsas somente para escrita cliente. SELECT, RLS, triggers, constraints, owners e grants de servidor preservados. Nenhum default global alterado: futuras tabelas exigem classifica??o expl?cita. Escritas de service_role privilegiado n?o s?o acesso cliente autorizado.

Preflight: executar invent?rio em banco descart?vel e confirmar papel efetivo da API, objetos esperados e aus?ncia de RPC/view com escrita privilegiada; abortar se houver consumidor leg?timo de escrita direta. A migration aborta atomicamente por tabela ausente, cliente superuser/bypass ou DML herdado remanescente. N?o tenta alterar memberships desconhecidas. Postcheck: repetir invent?rio, confirmar DML efetivo negado e leituras inalteradas, executar matriz negativa e regress?o API. Compatibilidade com API anterior ? hip?tese sustentada pelo runner postgres, ainda requer prova integrada.

Recupera??o: falha dentro de BEGIN/COMMIT reverte toda a migration; em descart?vel descartar ambiente por infraestrutura existente. Ap?s aplica??o controlada futura, preferir corre??o aditiva; restaurar ACLs somente de snapshot revisado e nunca reabrir DML cliente como rollback autom?tico. N?o h? script de rollback que reative a vulnerabilidade.

| Tabela                  | Papel                            | SELECT             | INSERT     | UPDATE     | DELETE     | Origem antes                                                | Dom?nio / a??o                            |
| ----------------------- | -------------------------------- | ------------------ | ---------- | ---------- | ---------- | ----------------------------------------------------------- | ----------------------------------------- |
| contracts               | authenticated (todos perfis JWT) | RLS preservada     | revogado   | revogado   | revogado   | grant 20260812 ou defaults gerenciados; RLS varia           | API transacional obrigat?ria              |
| contracts               | anon / PUBLIC                    | sem nova concess?o | revogado   | revogado   | revogado   | anon j? restrito 20261101; PUBLIC efetivo requer invent?rio | negar escrita                             |
| contracts               | API postgres no runner           | servidor           | preservado | preservado | preservado | owner/superuser/bypass                                      | validar papel efetivo antes de hospedagem |
| receivables             | authenticated (todos perfis JWT) | RLS preservada     | revogado   | revogado   | revogado   | grant 20260812 ou defaults gerenciados; RLS varia           | API transacional obrigat?ria              |
| receivables             | anon / PUBLIC                    | sem nova concess?o | revogado   | revogado   | revogado   | anon j? restrito 20261101; PUBLIC efetivo requer invent?rio | negar escrita                             |
| receivables             | API postgres no runner           | servidor           | preservado | preservado | preservado | owner/superuser/bypass                                      | validar papel efetivo antes de hospedagem |
| receivable_installments | authenticated (todos perfis JWT) | RLS preservada     | revogado   | revogado   | revogado   | grant 20260812 ou defaults gerenciados; RLS varia           | API transacional obrigat?ria              |
| receivable_installments | anon / PUBLIC                    | sem nova concess?o | revogado   | revogado   | revogado   | anon j? restrito 20261101; PUBLIC efetivo requer invent?rio | negar escrita                             |
| receivable_installments | API postgres no runner           | servidor           | preservado | preservado | preservado | owner/superuser/bypass                                      | validar papel efetivo antes de hospedagem |
| payments                | authenticated (todos perfis JWT) | RLS preservada     | revogado   | revogado   | revogado   | grant 20260812 ou defaults gerenciados; RLS varia           | API transacional obrigat?ria              |
| payments                | anon / PUBLIC                    | sem nova concess?o | revogado   | revogado   | revogado   | anon j? restrito 20261101; PUBLIC efetivo requer invent?rio | negar escrita                             |
| payments                | API postgres no runner           | servidor           | preservado | preservado | preservado | owner/superuser/bypass                                      | validar papel efetivo antes de hospedagem |
| payment_allocations     | authenticated (todos perfis JWT) | RLS preservada     | revogado   | revogado   | revogado   | grant 20260812 ou defaults gerenciados; RLS varia           | API transacional obrigat?ria              |
| payment_allocations     | anon / PUBLIC                    | sem nova concess?o | revogado   | revogado   | revogado   | anon j? restrito 20261101; PUBLIC efetivo requer invent?rio | negar escrita                             |
| payment_allocations     | API postgres no runner           | servidor           | preservado | preservado | preservado | owner/superuser/bypass                                      | validar papel efetivo antes de hospedagem |
| payment_reversals       | authenticated (todos perfis JWT) | RLS preservada     | revogado   | revogado   | revogado   | grant 20260812 ou defaults gerenciados; RLS varia           | API transacional obrigat?ria              |
| payment_reversals       | anon / PUBLIC                    | sem nova concess?o | revogado   | revogado   | revogado   | anon j? restrito 20261101; PUBLIC efetivo requer invent?rio | negar escrita                             |
| payment_reversals       | API postgres no runner           | servidor           | preservado | preservado | preservado | owner/superuser/bypass                                      | validar papel efetivo antes de hospedagem |
| payment_change_requests | authenticated (todos perfis JWT) | RLS preservada     | revogado   | revogado   | revogado   | grant 20260812 ou defaults gerenciados; RLS varia           | API transacional obrigat?ria              |
| payment_change_requests | anon / PUBLIC                    | sem nova concess?o | revogado   | revogado   | revogado   | anon j? restrito 20261101; PUBLIC efetivo requer invent?rio | negar escrita                             |
| payment_change_requests | API postgres no runner           | servidor           | preservado | preservado | preservado | owner/superuser/bypass                                      | validar papel efetivo antes de hospedagem |
| financial_adjustments   | authenticated (todos perfis JWT) | RLS preservada     | revogado   | revogado   | revogado   | grant 20260812 ou defaults gerenciados; RLS varia           | API transacional obrigat?ria              |
| financial_adjustments   | anon / PUBLIC                    | sem nova concess?o | revogado   | revogado   | revogado   | anon j? restrito 20261101; PUBLIC efetivo requer invent?rio | negar escrita                             |
| financial_adjustments   | API postgres no runner           | servidor           | preservado | preservado | preservado | owner/superuser/bypass                                      | validar papel efetivo antes de hospedagem |
| renegotiations          | authenticated (todos perfis JWT) | RLS preservada     | revogado   | revogado   | revogado   | grant 20260812 ou defaults gerenciados; RLS varia           | API transacional obrigat?ria              |
| renegotiations          | anon / PUBLIC                    | sem nova concess?o | revogado   | revogado   | revogado   | anon j? restrito 20261101; PUBLIC efetivo requer invent?rio | negar escrita                             |
| renegotiations          | API postgres no runner           | servidor           | preservado | preservado | preservado | owner/superuser/bypass                                      | validar papel efetivo antes de hospedagem |
| expenses                | authenticated (todos perfis JWT) | RLS preservada     | revogado   | revogado   | revogado   | grant 20260812 ou defaults gerenciados; RLS varia           | API transacional obrigat?ria              |
| expenses                | anon / PUBLIC                    | sem nova concess?o | revogado   | revogado   | revogado   | anon j? restrito 20261101; PUBLIC efetivo requer invent?rio | negar escrita                             |
| expenses                | API postgres no runner           | servidor           | preservado | preservado | preservado | owner/superuser/bypass                                      | validar papel efetivo antes de hospedagem |
| payment_receipts        | authenticated (todos perfis JWT) | RLS preservada     | revogado   | revogado   | revogado   | grant 20260812 ou defaults gerenciados; RLS varia           | API transacional obrigat?ria              |
| payment_receipts        | anon / PUBLIC                    | sem nova concess?o | revogado   | revogado   | revogado   | anon j? restrito 20261101; PUBLIC efetivo requer invent?rio | negar escrita                             |
| payment_receipts        | API postgres no runner           | servidor           | preservado | preservado | preservado | owner/superuser/bypass                                      | validar papel efetivo antes de hospedagem |
| audit_logs              | authenticated (todos perfis JWT) | RLS preservada     | revogado   | revogado   | revogado   | grant 20260812 ou defaults gerenciados; RLS varia           | API transacional obrigat?ria              |
| audit_logs              | anon / PUBLIC                    | sem nova concess?o | revogado   | revogado   | revogado   | anon j? restrito 20261101; PUBLIC efetivo requer invent?rio | negar escrita                             |
| audit_logs              | API postgres no runner           | servidor           | preservado | preservado | preservado | owner/superuser/bypass                                      | validar papel efetivo antes de hospedagem |

Tabelas indiretas fora da migration: service_catalog_items (sem policy cliente), documents/document_versions (metadados/evid?ncias e Storage), organizations.settings (pol?tica de aprova??o), users/roles/role_permissions/organization_members/organization_member_roles (autoriza??o). N?o afetam ledger diretamente, mas exigem revis?o efetiva de autoriza??o antes de release. A presente an?lise n?o certifica fechamento de escalada por tabelas de identidade ou fun??es externas.

## C. Seguran?a e cobertura

RLS-WRITE original mantido, agora registra status HTTP do SDK al?m de erro. Novo RLS-WRITE-MATRIX usa JWT Auth real de administrador, financeiro, advogado, secretaria e cliente vinculado. Para as 12 tabelas tenta POST/PATCH/DELETE, exige 42501 na fronteira de privil?gio e compara snapshot bruto PostgreSQL antes/depois. Isso cobre nega??o por opera??o/tabela; n?o substitui fixtures espec?ficas de todos os campos solicitados, testes anon, grants por coluna injetados nem RPCs/views efetivos. Execu??o ainda NOT_EXECUTED. Nenhuma alega??o de estado persistido novo ou HTTP observado.

Regress?es positivas existentes permanecem no orquestrador: pagamentos/parciais/quita??o, estorno, corre??o, concorr?ncia, rollback, despesas, relat?rios/exporta??es e isolamento/portal. Os 28 PASS anteriores pertencem ao SHA original, n?o ? migration proposta. Nova candidata requer repeti??o completa.

## D. Financeiro

CEN-006: patch tempor?rio indicado n?o existe no caminho fornecido; n?o aplicado. Corrigidas pr?-condi??es diretamente: linhas PDF com coordenadas expl?citas, data UTC de ontem e correctionReason expl?cito id?ntico nos retries. Mantidas identidade por recibo/refer?ncia, overlap/barreira, transa??es paralelas e todas assertions financeiras. Extra??o 70/data e chegada de duas transa??es ? barreira ainda dependem do runner; n?o declarar PASS.

DEF-006: adicionados casos de CANCELLED, WRITTEN_OFF, OPEN, PARTIALLY_PAID real com pagamento 25 e OVERDUE. Verificam rejei??o/repeti??o, snapshot quando negado e n?mero de d?vidas. REN-001 mant?m concorr?ncia real. Novos casos ainda n?o executados no PostgreSQL; hist?rico/auditoria completos e concorr?ncia por cada estado exigem amplia??o adicional.

DEF-007: testes existentes de provedor retornando erro/sucesso e compensa??o real bem-sucedida preservados. Adicionados casos provider-error/provider-unavailable: falha controlada no remove do cliente Storage, upload real preservado, rejei??o e invent?rio SQL de ?rf?o exigidos. Execu??o integrada ainda pendente. N?o existe reconcilia??o autom?tica demonstrada; registrar necessidade operacional de listar/reconciliar objetos ?rf?os separadamente, sem fingir recupera??o.

## E. Matriz das 28 funcionalidades

MATRIZ_FINANCEIRA_ETAPA3.csv preserva as 28 linhas e evid?ncia hist?rica. A coluna stage32 informa nova valida??o pendente para cada opera??o. FIN-004/005/009 n?o s?o PASS integral. Nova matriz de DML cobre fronteira SQL, n?o equivale a aprova??o funcional completa.

## F. Publica??o e classifica??o

N?o houve commit/push/merge/deploy/migration hospedada nem escrita compartilhada. Docker/psql n?o encontrados; infraestrutura pesada n?o instalada. CI existente aplica migrations no Supabase ef?mero e executa o orquestrador, sem altera??o necess?ria ao workflow. Opera??o m?nima futura: autoriza??o expl?cita para publicar diff revisado em commit/push na branch da PR #3 (draft), mantendo bloqueios Vercel, para evento pull_request executar job integrado. Nenhuma autoriza??o solicitada nesta execu??o.

| Classifica??o              | Estado       | Evid?ncia                                                      |
| -------------------------- | ------------ | -------------------------------------------------------------- |
| DEF_008_RLS_WRITE          | PARTIAL      | SQL preparado; reprodu??o anterior FAIL; p?s-corre??o pendente |
| DIRECT_FINANCIAL_DML       | PARTIAL      | 12 tabelas, matriz negativa preparada, n?o executada           |
| API_FINANCIAL_OPERATIONS   | NOT_EXECUTED | nova candidata sem banco                                       |
| FINANCIAL_RLS_READ         | NOT_EXECUTED | SELECT n?o alterado; requer regress?o                          |
| FINANCIAL_CONCURRENCY      | NOT_EXECUTED | barreiras preservadas, nova rodada pendente                    |
| PAYMENT_IDEMPOTENCY        | NOT_EXECUTED | somente evid?ncia anterior                                     |
| PAYMENT_REVERSALS          | NOT_EXECUTED | somente evid?ncia anterior                                     |
| EXPENSE_INTEGRITY          | NOT_EXECUTED | somente evid?ncia anterior                                     |
| DEF_006_INTEGRATED         | PARTIAL      | REN-001 anterior PASS; novos estados preparados                |
| DEF_007_INTEGRATED         | PARTIAL      | sucesso anterior; falhas integradas pendentes                  |
| CEN_006_HARNESS            | PARTIAL      | pr?-condi??es corrigidas sem execu??o PostgreSQL               |
| FINANCIAL_SECURITY_RELEASE | BLOCKED      | invent?rio efetivo e provas integradas pendentes               |
| INTEGRATED_QA              | NOT_EXECUTED | nova candidata local                                           |
| PRODUCTION_GO_NO_GO        | FAIL         | DEF-008 n?o certificado como fechado                           |

Valida??es locais e diff exato: ser?o registrados ao concluir os processos em execu??o. Esta candidata ainda n?o atende todos os crit?rios para publica??o; revis?o dos caminhos indiretos e casos faltantes precisa preceder aprova??o de release.

## Valida??es finais locais

- Vitest: 222 API + 42 web + 20 shared = 284 PASS.
- Suporte do harness: 16/16 PASS; node --check e ESLint do harness final PASS. Lint global e format:check PASS (401 arquivos; contexto local exclu?do pelo checker preexistente).
- TypeScript API/web e builds shared/db/ui/API PASS. Build web PASS com configura??o p?blica sint?tica loopback, depois de falhar pela aus?ncia dessas vari?veis; nenhuma configura??o compartilhada utilizada.
- Prisma Validate PASS com DATABASE_URL sint?tica loopback, sem conex?o; primeira tentativa sem vari?vel falhou P1012. Aviso metrics depreciado preexistente.
- PDF sint?tico com linhas posicionadas passou pelo ReceiptExtractionService real compilado: PDF_TEXT, paidAmount 70.00, paidDate 2026-11-10, warnings vazio. Isso n?o comprova concorr?ncia nem PostgreSQL.
- git diff --check PASS. Nenhuma migration SQL executada, portanto sintaxe/ACLs efetivas e compatibilidade PostgreSQL continuam NOT_EXECUTED.

Arquivos desta etapa: PROJECT_CONTEXT.md (acr?scimo final), MATRIZ_FINANCEIRA_ETAPA3.csv (coluna stage32 nas 28 linhas), tools/qa/financial-integrity-ci.mjs, tools/qa/financial-security-inspect.sql, supabase/migrations/20261111120000_financial_api_write_boundary.sql e este relat?rio. Outros documentos locais j? modificados e evid?ncias da etapa 3.1 foram preservados; n?o s?o novas corre??es desta etapa. O patch etapa32-codigo.patch cont?m o diff exato do c?digo/SQL contra bc9bc30; documenta??o e hashes est?o separados em VALIDACAO_ETAPA3_2.json.

Pend?ncias antes de afirmar fechamento: executar invent?rio efetivo e migration no descart?vel; validar matriz de escrita e regress?o completa, ampliar sondagem de caminhos indiretos (identidade/configura??o/documentos), RPC/views gerenciados e casos espec?ficos por campo/anon. Os testes de estados de renegocia??o n?o cobrem corrida por cada estado nem todas as assertions de hist?rico; DEF-007 novo depende do runner. Nenhuma dessas pend?ncias foi convertida em PASS.
