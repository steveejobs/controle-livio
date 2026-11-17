# Etapa 3.3 - preflight consolidado DEF-008

Data: 2026-11-11. Candidata local pronta para revisao e uma CI descartavel. Nenhum fechamento integrado ou liberacao de Production e declarado.

## Estado confirmado

Branch `validation/audit-stage2-20261104`, HEAD `bc9bc30101e4c92a51eeb676375d40d927ea34f1`. GitHub consultado somente por leitura: PR #3 OPEN/draft, mesmo head, Quality 41887379143 failure. Os outros dois worktrees, conflitos do checkout principal e documentos locais anteriores foram preservados.

Snapshot privado anterior a esta etapa: pasta temporaria `livio-etapa33-baseline-wZdpUR`. Os seis hashes e o hash do patch de VALIDACAO_ETAPA3_2 foram conferidos contra esse snapshot: todos correspondem. Esse manifesto e o patch 3.2 ficam historicos; nao descrevem o novo codigo. O manifesto 3.3 identifica o pacote atual.

## Revisao SQL e arquitetura

A migration conserva o nome `20261111120000_financial_api_write_boundary.sql`, pois nunca foi publicada/aplicada. Vem depois de recibos (20261031120000) e restricao publica (20261101100000). Nao ha migration posterior no historico local.

Revisao por blocos:

1. BEGIN/COMMIT inclui ACLs, policies, funcoes e triggers; erro desfaz o pacote inteiro.
2. Os 12 modelos financeiros existem no Prisma e nas migrations oficiais. O catalogo por objeto esta em OBJETOS_DEF008_ETAPA3_3.json. Proprietario hospedado e ACLs efetivas nao foram presumidos.
3. Referencias qualificadas `public`, nomes de tabela de lista constante e quoting `%I`. Cada tabela deve existir, ser ordinaria e ter RLS/ FORCE RLS ativos; divergencia aborta.
4. REVOKE retira INSERT/UPDATE/DELETE de PUBLIC, anon e authenticated. A passagem explicita por colunas e a verificacao efetiva cobrem ACL de coluna e grants residuais. Nao ha CASCADE de grants nem alteracao de memberships de PostgreSQL.
5. `has_table_privilege` e `has_any_column_privilege` detectam privilegios efetivos herdados remanescentes e abortam. `pg_has_role(...,'SET')` tambem rejeita caminho para superuser/BYPASSRLS, inclusive sem heranca imediata.
6. Policies RESTRICTIVE somente FOR INSERT, UPDATE e DELETE. Nenhuma FOR ALL ou SELECT. Policies de leitura anteriores, constraints e triggers de integridade permanecem.
7. Privillegios de servidor, owners e papel da API nao foram ampliados. A conexao Prisma usa DATABASE_URL, sem assumir papel JWT. O runner deve continuar postgres com bypass; o postcheck registra o papel e falha se esse contrato mudar. Papel hospedado continua desconhecido.
8. Nao ha DELETE de dados, DROP, TRUNCATE, reset, alteracao de valores financeiros ou desativacao de trigger/RLS nesta migration. Nao ha default privilege global novo. Tabelas futuras exigem classificacao explicita.

A sintaxe e a semantica foram confrontadas com [REVOKE PostgreSQL 17](https://www.postgresql.org/docs/17/sql-revoke.html), [CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html) e [funcoes de privilegio](https://www.postgresql.org/docs/17/functions-info.html). A revogacao de tabela no PostgreSQL 17 tambem revoga privilegios correspondentes de coluna; a passagem explicita e o postcheck mantem essa intencao verificavel. A heranca e caminhos SET ROLE sao verificacoes separadas.

## Caminhos indiretos e ampliacao minima

| Caminho                                                         | Permissao anterior necessaria                 | Efeito possivel / tratamento                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| organization_member_roles, roles, role_permissions, permissions | roles:manage                                  | Papel personalizado com manage podia tentar atribuir o papel oficial administrador, embora a API exija administrador. DML passa a ser exclusivo do servidor. Teste especifico cria papel personalizado e prova validade do INSERT com rollback.                                 |
| organization_members, users, user_roles                         | users:manage ou roles:manage, conforme policy | Alterar vinculo/identidade/escopo sem guardas administrativas da API. Mesma restricao de escrita. user_roles e legado, nao e a fonte corrente de roles da membership.                                                                                                           |
| organizations.settings                                          | organization:update                           | Desligar aprovacao sem endpoint administrativo/auditoria. DML exclusivo da API; teste tenta expenseApprovalRequired=false.                                                                                                                                                      |
| documents, document_versions                                    | documents:create/update                       | Reescrever vinculo, chave, hash ou ocultar evidencia. Escrita pela API ja e o consumo de produto; agora cliente nao pode gravar metadados por PostgREST.                                                                                                                        |
| storage.objects em evidencia financeira                         | documents:update/delete                       | Sobrescrever/remover original sem revisao de comprovante. Policies restritivas somente UPDATE/DELETE protegem objetos vinculados a contrato/parcela/pagamento/despesa/recibo. Upload de novos objetos comuns e leitura continuam com as policies anteriores.                    |
| clients.id/organization_id e matters.id/organization_id         | clients:update / matters:update               | Mudanca de tenant ou ON UPDATE CASCADE pode atingir filhos financeiros sem DML direto neles. Trigger invoker rejeita mudanca de identidade/tenant, inclusive pelo servidor; edicoes comuns e criacao permanecem disponiveis. DTOs da API nao oferecem esses campos como edicao. |

O alcance e 12 tabelas financeiras + 10 dependencias de autorizacao/evidencia, dois triggers de identidade em pais e duas policies Storage. Isso foi incorporado a mesma migration, sem sistema paralelo de autorizacao.

Os caminhos adicionais sao inferencias concretas do SQL versionado, **nao novos P0 reproduzidos na stack Supabase**. A candidata inclui os testes para verifica-los. Permissoes dos perfis padrao nao foram confundidas com papel personalizado que recebeu manage.

`is_financial_storage_object(text)` e uma funcao SECURITY DEFINER somente de leitura, retorna boolean e usa apenas tabelas qualificadas com search_path=pg_catalog. Nao recebe tenant/SQL arbitrario, nao faz DML e nao concede poder administrativo. PUBLIC/anon nao tem EXECUTE; authenticated recebe somente EXECUTE dessa consulta. Esse bypass de leitura interna e necessario porque receipts e RLS default-deny: um EXISTS sujeito ao RLS do cliente ocultaria o proprio vinculo que precisa proteger. O teste RPC identifica a evidencia e compara estado depois das tentativas Storage. O owner efetivo da funcao deve conservar capacidade de leitura das tabelas FORCE RLS no runner.

As demais funcoes versionadas SECURITY DEFINER sao helpers de identidade/permissao/download e sincronizacao de profile via trigger de Auth. Metadados Auth atualizam profile, nao roles/membership. Funcoes trigger nao sao RPCs de negocio. Nao ha view/RPC de escrita financeira declarada nas migrations. O postcheck captura definicoes/ACL/owners das funcoes, detecta definers executaveis nao revisados, views/materialized views/foreign tables inesperadas e heranca efetiva. Nomes conhecidos nao equivalem a certificacao de objetos hospedados desconhecidos.

Service role permanece exclusivamente no servidor para Auth/Storage. Frontend de produto usa API para os dominios afetados; a busca de from/rpc nao revelou escrita direta financeira ou de metadados. O consumidor direto de metadados encontrado era o teste RLS: ele agora exige 42501 do cliente e prepara fixtures pelo Prisma, mantendo a prova positiva de upload, leitura e URL assinada de documento comum. Nada foi aberto para acomodar teste.

## Testes preparados e criterios de resultado

RLS-WRITE original permanece. RLS-WRITE-MATRIX foi substituido por casos individuais: 6 perfis (inclui anon) x 12 tabelas x 3 operacoes = 216 tentativas. Cada fixture tem alvo persistido; INSERT candidato e primeiro criado via Prisma numa transacao revertida e depois inserido com o JSON exato via PostgreSQL numa segunda transacao revertida. Isso comprova required fields, tipos, FKs, uniques e triggers antes de testar negacao. UPDATE usa campo de estado/valor/aprovacao/historico relevante; DELETE sempre filtra ID existente. JWT e membership ativa sao confirmados antes dos casos autenticados. Falha de setup nao gera PASS de seguranca.

Registro por caso: ator/perfil/organizacao, alvo e payload, HTTP observado, codigo e mensagem, classificacao de negacao, alvo anterior e fingerprints SHA-256/contagem antes/depois de tabelas financeiras, evidencia e autorizacao. Sem token/chave na evidencia. As comparacoes nao fazem aritmetica monetaria em Number. `PRIVILEGE_DENIED`, `RLS_DENIED`, `AUTHENTICATION_FAILURE`, `WRITE_ACCEPTED` e `HARNESS_OR_DOMAIN_FAILURE` sao distintos. Zero linhas/HTTP 2xx nao e negacao. Erro de rede, FK ou payload nao satisfaz a assertion. Para essa migration a matriz exige negacao de privilegio; o teste dos triggers pais admite 23514 com estado preservado ou 42501 por RLS.

Leitura por perfil verifica pagamento proprio autorizado (administrador/financeiro/cliente), invisibilidade para advogado/secretaria e outra organizacao. Anon tem tentativa especifica de leitura/escrita. As suites anteriores preservam leitura de demais dominios, notas privadas, Storage e portal. O controle SQL compara policies SELECT antes/depois; a regressao completa de leitura continua dependente da CI.

Casos indiretos verificam configuracao, metadados, autorizacao e pais. Papel personalizado recebe granularmente users:manage, roles:manage e organization:update, mas nao administrador: endpoint administrativo deve retornar 403 e INSERT de auto-promocao deve retornar negacao SQL sem estado novo. Storage testa overwrite e remove com perfis reais; remove pode retornar sucesso vazio sob RLS, portanto a prova e a preservacao dos bytes/hash e do estado, nao um HTTP arbitrario.

Regressoes positivas mantidas: contrato (novo controle API + auditoria), recebivel/parcelamento, parcial/quitacao, estorno, correcao, renegociacao, ciclo completo de despesas/aprovacao independente/cancelamento, comprovantes, historico/auditoria, relatorios/CSV e portal/isolamento. Nao houve aumento de timeout nem remocao de assertions financeiras. Falha de qualquer caso deixa a suite FAIL, mesmo que o wrapper de setup tenha concluido.

CEN-006: PDF posicionado em linhas, valor 70.00 e data extraidos pelo servico, data de ontem ao meio-dia UTC, motivo explicito identico nos retries, IDs de recibo e documento distintos, referencia por recibo. A barreira original exige duas transacoes esperando e preserva chamadas paralelas; extracao local nao vale como PASS integrado.

DEF-006: CANCELLED/WRITTEN_OFF tentados em paralelo e repetidos sem criacao de substituta; OPEN/PARTIALLY_PAID/OVERDUE usam barreira real, duas referencias distintas, exatamente uma aceitacao e uma rejeicao. Partial tem pagamento real anterior. Snapshot inclui dividas/parcelas, renegociacoes, ledger e auditoria. Estados validos exigem uma substituta OPEN, um historico APPROVED e um audit APPROVE; invalidos devem preservar todo snapshot.

DEF-007: sucesso de compensacao real preservado; erro retornado pelo provedor e indisponibilidade sao injetados exclusivamente na remocao, mantendo upload/SQL reais no runner. O harness exige erro comunicado, falha SQL atingida, ausencia de recibo/documento ativo e evidencia do objeto orfao nos casos de falha. A injecao e de servico, nao falha HTTP observada do provedor hospedado. Nao existe reconciliacao automatica: orfaos exigem tratamento operacional posterior, fora desta correcao.

## Validacao local e fronteira da evidencia

- 284 Vitest PASS; 19 testes Node de suporte PASS.
- Lint, format check, TypeScript, Prisma Validate, builds API/web e diff check executados; resultados finais no manifesto.
- PGlite 0.3.14 instalado somente em pasta temporaria com ignore-scripts, sem dependencia/lockfile novo no repositorio ou servico local. Motor PostgreSQL 17.5 em memoria: migration real aplicada em schema minimo sintetico. Quatro casos PASS: normal, grant herdado, tabela ausente, acesso SET ROLE a bypass. Prova preservacao de SELECT/ACL servidor, DML/colunas/PUBLIC, atomicidade e protecao seletiva do Storage. O schema minimo nao substitui migrations reais, Prisma/NestJS, Supabase Auth, PostgREST ou concorrencia.
- SQL versionado, triggers de dominio, todos os payloads e as chamadas Auth/PostgREST reais ainda exigem a stack descartavel completa. Nenhuma credencial compartilhada utilizada; nao foi instalado Docker ou servico PostgreSQL.

## Pacote, preflight e execucao futura

VALIDACAO_ETAPA3_3.json identifica whitelist, origem, hashes, arquivos novos/modificados e documentos anteriores excluidos. etapa33-candidata.patch e o diff consolidado contra bc9bc30 para essa whitelist; exclui o proprio patch e manifesto para evitar dependencia circular. Etapa 3.1 e os documentos de progresso/defeitos anteriores continuam no worktree, sem inclusao automatica na whitelist. Contexto e matriz financeira incluem as anotacoes locais financeiras anteriores explicitamente identificadas, sem importar a candidata HTTPS.

Preflight controlado futuro: verificar hashes do pacote, branch/head, diff e bloqueios de deployment; confirmar que a stack efemera nao tem link cloud/dotenv/credenciais externas; revisar catalogo antes de aplicar em qualquer banco existente. Nunca usar o banco compartilhado para esses testes. `financial-security-inspect.sql` fornece o inventario manual antes/depois; `financial-security-ci.mjs` faz postcheck automatico e falha com grants/policies/roles inesperados no runner.

O Quality existente usa config.toml PostgreSQL major_version=17. `prepare-local-supabase-ci.mjs` exige runner GitHub Linux, nao aceita credenciais externas/vinculo hospedado e aplica todas as migrations versionadas com --local antes do navegador. A journey financeira importa o novo postcheck/matriz e executa os 19 testes de suporte. O verificador antigo de recibos foi atualizado para tres policies RESTRICTIVE de escrita, sem permissiva/SELECT/ALL, evitando falha artificial. O workflow continua sem alteracao; o evento pull_request da PR #3 executa integracao e restore, enquanto push dessa branch sozinho nao executa esses dois jobs.

Os dois vercel.json continuam deploymentEnabled=false para essa branch, sem mudanca nesta etapa. Nenhuma configuracao Vercel, ambiente, PR ou infraestrutura foi alterada. As variaveis de build local foram apenas placeholders loopback no processo. A consulta GitHub foi somente leitura.

Recuperacao: erro de migration reverte a transacao integralmente (verificado no motor minimo). Em runner, finalizar somente a stack descartavel existente. Apos eventual aplicacao controlada futura, preferir correcao aditiva; nao reativar DML financeiro cliente como rollback automatico. Sem script destrutivo nem limpeza de historico. Nao ha autorizacao para migration hospedada.

Operacao minima futura, depois da revisao do pacote: autorizacao especifica para um commit/push da whitelist na branch da PR #3, mantendo draft e bloqueios Vercel, para uma rodada Quality completa no evento da PR. Esta execucao nao faz essa publicacao.

## Classificacao

| Classificacao           | Estado       | Evidencia                                                                              |
| ----------------------- | ------------ | -------------------------------------------------------------------------------------- |
| DEF_008_SQL_READY       | PASS         | Revisao + migration real no motor PG17.5 minimo, quatro casos; stack completa pendente |
| DIRECT_DML_GUARDS       | PARTIAL      | ACL/policies no motor minimo; 216 tentativas Auth/PostgREST preparadas                 |
| INDIRECT_WRITE_PATHS    | PARTIAL      | Caminhos concretos inspecionados e guards/testes preparados; prova integrada pendente  |
| API_WRITE_COMPATIBILITY | PARTIAL      | ACL servidor preservada no controle SQL; regressao NestJS preparada                    |
| RLS_READ_COMPATIBILITY  | PARTIAL      | SELECT inalterado no controle SQL; perfis/portal reais pendentes                       |
| CEN_006_READY           | PASS         | Entradas e barreira revisadas; sem PASS de concorrencia integrado                      |
| DEF_006_READY           | PASS         | Cinco estados, concorrencia/repeticao/historico/auditoria preparados                   |
| DEF_007_READY           | PASS         | Sucesso/erro/indisponibilidade/orfao e erro comunicado preparados                      |
| CI_PREPARATION          | PASS         | Whitelist, diff, hashes, workflow e guards conferidos                                  |
| INTEGRATED_QA           | NOT_EXECUTED | Nenhuma nova execucao da stack completa                                                |
| PRODUCTION_GO_NO_GO     | FAIL         | P0 somente podera ser considerado fechado apos CI completa e revisao                   |
