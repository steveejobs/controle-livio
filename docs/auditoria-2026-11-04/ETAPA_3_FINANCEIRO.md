# Etapa 3 — integridade financeira, concorrência, estornos e despesas

Data: 2026-11-04. Produção **NO-GO**.

## Identidade e continuidade

- Worktree de trabalho: `C:/Users/jarde/Documents/GitHub/controle-livio-audit-stage2-validation-20261104`.
- Branch: `validation/audit-stage2-20261104`; HEAD inicial/final versionado `20646dc2de791df88933996531852133cc462027`, com alterações locais desta etapa. Nenhum commit ou push.
- Base aprovada: `5521a3f1cebe38e8d89b0ceef38db808c5154fc9`. Quality histórico aprovado: [41850303146](https://github.com/steveejobs/controle-livio/actions/runs/41850303146), merge sintético `91eff17d5c3c348208479c93a23c5e55beca14f4`.
- PR #3 permanece em rascunho; nenhum merge, deploy, workflow manual, mudança cloud ou migration remota foi realizado.
- Checkout principal `controle-livio`, HEAD `af41f4c`, contém conflitos preexistentes em contexto/documentação/README QA e mudanças da auditoria; foi somente lido. Worktree destacado `controle-livio-audit-stage25-local` também preservado. Não foi transportada a candidata HTTPS.
- Os seis documentos cumulativos desta pasta foram copiados do checkout principal, sem alterar os originais, pois não existiam no checkout aprovado. Seus registros anteriores são históricos. `ETAPA_2_9.md` preserva o relatório aprovado e aponta às evidências originais em `C:/Users/jarde/AppData/Local/Temp/livio-quality-41850303146`.
- As provas do Quality anterior não foram atribuídas às mudanças locais. Não existe Quality da etapa 3.

## Ambiente efetivamente disponível

Não há `docker`, `postgres`, `initdb`, `pg_ctl` ou `psql` utilizáveis no PATH. A pasta `C:/Program Files/PostgreSQL/17` contém somente `data`, sem binários; não foi aberta nem reutilizada como banco de testes. Nenhum serviço de outro projeto foi encerrado. Nenhum `.env` foi lido/carregado nesta etapa.

Executados localmente: serviço de domínio com adaptadores instrumentados, adaptador Storage com resposta de erro simulada, schemas reais, testes existentes, segurança do harness, parser/listagem Playwright e gates. **Nenhuma nova consulta ou escrita PostgreSQL foi executada nesta etapa.** O bloqueio para os testes reais é a ausência de pilha descartável local e a necessidade de autorização de publicação para o runner existente.

## A. Modelo financeiro e operações reais

O catálogo complementar `FINANCEIRO_FUNCIONAL_ETAPA3.json` deduplica os 71 candidatos de finance/reports em **28 funcionalidades**, com IDs estáveis, operações, estados, permissões e vínculos aos candidatos originais. Os 213 candidatos foram preservados integralmente em `INVENTARIO_FUNCIONAL_COMPLETO.json`; 142 fora do recorte financeiro ainda não foram deduplicados. O total global de funcionalidades únicas continua indeterminado.

| IDs             | Funcionalidade                      | Operações/contratos                                                                                                                                                                                              |
| --------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FIN-001/002     | Catálogo e contratos                | Criar/listar serviços, criar/listar contratos e vínculos; não presumir edição/cancelamento ausentes nesses controllers                                                                                           |
| FIN-003         | Recebíveis e parcelas               | Criar/listar/consultar; soma exata de parcelas e moeda explícita                                                                                                                                                 |
| FIN-004         | Pagamentos/alocações                | Criar/listar, chave idempotente por organização, hash do conteúdo, saldo não excedido                                                                                                                            |
| FIN-005         | Estorno                             | Integral, administrador + payments:approve; pagamento preservado REVERSED, alocações marcadas e linha de compensação                                                                                             |
| FIN-006         | Correções                           | Proposta/listagem/aprovação/rejeição; administrador cria substituto após compensar original, com baseVersion                                                                                                     |
| FIN-007         | Ajustes                             | DISCOUNT/INTEREST/PENALTY/CORRECTION/REVERSAL/OTHER, aprovação imediata pelo perfil autorizado                                                                                                                   |
| FIN-008         | Renegociação                        | Cancela origem, marca parcelas RENEGOTIATED, cria cobrança substituta e histórico                                                                                                                                |
| FIN-009         | Despesas                            | Criar/editar/submeter/aprovar/rejeitar/pagar/cancelar/listar/selecionar responsável                                                                                                                              |
| FIN-010/011/012 | Política/histórico/resumo           | Aprovação configurável, trilha administrativa por campo, totais por moeda/período                                                                                                                                |
| FIN-013/014     | Comprovantes/documentos financeiros | Upload, interpretação, revisão, decisão, pagamento, documentos privados e compensação de arquivo                                                                                                                 |
| REP-001…014     | Relatórios                          | Vencimento, recebido, competência, atrasados, aging, previsão, caixa, caixa por cliente, parciais, contratos ativos, receita por advogado/serviço, inadimplentes e conciliação; CSV é operação de cada relatório |

Permissões são explícitas no controller. Estorno, decisão de correção e exportação exigem administrador além da permissão. O serviço presume a autenticação feita pelo guard; chamadas diretas do serviço nos testes de falha não comprovam guard/RLS. Despesas permitem edição apenas DRAFT/REJECTED; submissão gera PENDING_APPROVAL ou APPROVED conforme política; aprovação própria é proibida; pagamento exige APPROVED e quitação integral; PAID não pode cancelar.

### Garantias no banco e no serviço

- Decimal(19,4), checks positivos, FKs restritivas, unicidade por organização para referência/externalId/idempotencyKey e para pagamento/parcela; tenant triggers impedem FKs cruzadas.
- `validate_payment_allocation` bloqueia pagamento e parcela e verifica capacidade, moeda e cliente, inclusive gravação direta.
- `protect_confirmed_payment` impede alteração da identidade financeira e exclusão de pagamentos confirmados/estornados; **não impede toda mudança de status**.
- Auditoria, reversals e versões documentais possuem triggers imutáveis. Não foram apagados dados de auditoria para limpar testes.
- Pagamento/estorno/correção/ajuste/renegociação: transação SERIALIZABLE, locks ordenados e retry limitado para P2034/P2010 com SQLSTATE 40001/40P01. Despesa: transação com lock de linha e update condicionado ao estado, sem declarar isolamento SERIALIZABLE inexistente.
- RLS é forçada, mas a API no runner usa papel administrativo; por isso a suíte inclui requisições reais autenticadas e tentativas PostgREST separadas.
- Limite identificado: autorização é verificada na admissão da requisição; não há releitura de membership dentro do commit financeiro. A prova preparada mede esse comportamento e nega a próxima requisição após suspensão; não aprova revogação retroativa de uma operação já admitida.

## B. Concorrência: 30 cenários consolidados preparados

Todos os cenários novos desta seção estão **BLOCKED para execução integrada**. O arquivo é `tools/qa/financial-integrity-ci.mjs`, acionado por um único novo teste em `apps/web/e2e/integrated/financial-integrity.integrated.e2e.ts`. Não há alteração de workflow. O Quality existente executará o arquivo na suíte completa; a focada mantém os seis cenários anteriores. Esperado: 15 testes Playwright completos (14 anteriores + um orquestrador), com 30 casos financeiros estruturados dentro do orquestrador. Esses números não são funcionalidades únicas nem resultados já aprovados.

| Cenário                              | Prova preparada / expectativa matemática                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CEN-001                              | Dois POSTs com mesma chave/conteúdo: um pagamento/alocação de 70, saldo 30; retry sem efeito novo                                                                                          |
| CEN-002                              | Duas chaves alocando 70 em saldo 100: somente uma aceita, nunca 140; saldo 30                                                                                                              |
| CEN-003                              | Parciais 20 e 30 simultâneos: duas alocações, saldo 50                                                                                                                                     |
| CEN-004                              | Após 40 pagos, duas quitações de 60: efeito único, total 100, saldo zero                                                                                                                   |
| CEN-005                              | Corpo de resposta descartado pelo cliente após commit e retry: um efeito de 33,34, saldo 66,66; falha de transporte injetada no cliente, não timeout real medido                           |
| CEN-006                              | PDFs diferentes de 70 na mesma parcela: uma confirmação, outro recibo permanece pendente; saldo 30; ambos repetidos sem novo efeito                                                        |
| CEN-007                              | Duas organizações, mesma referência/chave, transações simultâneas independentes, saldo 75 em cada; acesso cruzado negado                                                                   |
| REV-001                              | Quitação, estorno concorrente/repetido e justificativa inválida; um reversal, saldo reaberto 100                                                                                           |
| COR-001                              | Correção 40→30 concorrente com pagamento 70; total ativo 30 ou 100 conforme ordem, compensação preservada                                                                                  |
| REN-001                              | Renegociação concorrente/repetida: uma nova cobrança ativa de 100, nenhuma dívida duplicada; valida DEF-006                                                                                |
| EXP-LIFECYCLE                        | Editar/submeter/rejeitar/corrigir/ressubmeter/aprovar/pagar, com histórico                                                                                                                 |
| EXP-APPROVAL                         | Dois aprovadores independentes, uma aprovação                                                                                                                                              |
| EXP-PAYMENT                          | Duas quitações, um PAY auditado; retry não paga novamente                                                                                                                                  |
| EXP-CANCEL_APPROVAL                  | Cancelamento contra aprovação, estados finais válidos e nenhum pagamento                                                                                                                   |
| EXP-CANCEL_PAYMENT                   | Cancelamento contra pagamento: somente uma transição terminal                                                                                                                              |
| EXP-INVALID                          | DRAFT não paga; parcial não paga; aprovado não muda valor; autoaprovação negada                                                                                                            |
| ROLLBACK-payment                     | Falha após pagamento e alocação efetivamente inseridos, transação revertida; recovery válido                                                                                               |
| ROLLBACK-allocation-constraint       | Alocação 101 injetada num pagamento 25 contra parcela 100: trigger deve falhar pelo motivo correto e reverter escrita aninhada                                                             |
| ROLLBACK-installment                 | Falha após update da parcela; ledger e auditoria revertidos                                                                                                                                |
| ROLLBACK-audit                       | Falha após insert da auditoria: pagamento/alocação/status/auditoria transacionais revertidos                                                                                               |
| ROLLBACK-connection                  | Termina somente o backend PostgreSQL identificado dentro da própria transação sintética; nenhum processo alheio                                                                            |
| ROLLBACK-reversal/correction/expense | Três casos de falha na auditoria após compensação, substituição ou pagamento de despesa; snapshots devem permanecer iguais                                                                 |
| ROLLBACK-UPLOAD-document/receipt     | Dois casos: scanner/Storage reais, falha de escrita injetada no serviço; objeto removido, recibo ausente e documento não ativo; tombstone/auditoria preservados quando apropriado          |
| REPORT-001                           | Ground truth de caixa/cliente/CSV com reversão e despesas; comparação ao ledger                                                                                                            |
| AUTH-001                             | Cinco papéis: pagamento, estorno, aprovação, relatório, CSV e download privado; IDs de outro tenant, suspensão, JWT inválido e RLS de leitura                                              |
| AUTH-REVOKED                         | Membership suspensa enquanto request já admitido espera lock; mede admissão vs commit e nega nova requisição                                                                               |
| RLS-WRITE                            | Financeiro tenta status REVERSED em pagamento e PAID em despesa DRAFT por PostgREST: não deve contornar autorização/auditoria da API; risco estático importante, poderá revelar falha real |

A barreira mantém uma transação própria com FOR UPDATE e usa `pg_blocking_pids` recursivo para exigir que as duas requisições reais estejam bloqueadas antes de liberar. Não transforma chamadas sequenciais em concorrência fictícia. Snapshots incluem IDs sintéticos, ator, organização, HTTP, pagamentos, alocações, reversals, pedidos de correção, saldo, estados e auditoria. Casos de falha chamam serviços compilados com Prisma/Storage/ClamAV reais e wrappers de injeção explícitos; não são apresentados como requisições HTTP.

O harness usa duas organizações novas, papéis copiados exatamente do seed e usuários `.test` confirmados localmente. Isso evita depender dos saldos/contagens globais ou do rate limit dos usuários das jornadas anteriores. Não enfraquece permissões ou rate limits. Não lê `.env`, exige URLs loopback/flags de ambiente/ClamAV do runner e recusa sobrescrever evidência anterior. Falhas são registradas por caso e a suíte termina vermelha se qualquer caso falhar.

## C. Estornos e correções

Implementação encontrada: estorno **integral**, sem apagar pagamento; parcial não é oferecido pelo contrato da API. Não foi criada funcionalidade parcial para ampliar cobertura. O schema aceita somente motivo como campo de negócio; não enviar `amount` supondo suporte parcial. Repetição de estorno exige rejeição 409, preservando a compensação original. Correção mantém original REVERSED e cria substituto, com histórico do pedido e aprovação administrativa. A execução PostgreSQL desses novos casos está pendente; testes unitários existentes passaram nos gates, o que não equivale a aprovação integral.

## D. Despesas

Máquina de estados inspecionada: DRAFT → PENDING_APPROVAL → APPROVED → PAID; REJECTED pode voltar a DRAFT por edição e ser reenviado; política sem aprovação permite DRAFT → APPROVED na submissão. CANCELLED é terminal; PAID não cancela. Aprovação é independente do criador. Valor após aprovação não é editável; pagamento parcial retorna erro. Método e referência de pagamento são preservados na auditoria, não em um novo Payment de entrada.

A concorrência simulada existente em unidade serializa callbacks; ela não foi contada como prova PostgreSQL. As seis novas provas de despesas e o rollback de PAY estão preparadas e não executadas no banco.

## E. Relatórios e ground truth

REPORT-001 usa período exclusivo 2040-01. Recebível 100.0000; pagamento 20 estornado; pagamento ativo 77.7777; despesa paga 12.1111; despesa aprovada pendente 20.0000. Esperados: recebido 77.7777, despesa paga 12.1111, caixa líquido 65.6666, saldo a receber 22.2223, despesa prevista 20.0000. CSV precisa conter os valores correspondentes às linhas já validadas e não apenas ser baixado.

Esses totais **não foram avaliados contra PostgreSQL nesta etapa**. Localmente passaram os testes existentes de transformação Decimal/CSV/serviço. Relatórios de caixa preservam quatro casas; outros normalizam saída a duas casas — registrar esse contrato, sem confundir apresentação com representação financeira interna. SQL agrupa datas conforme sessão do banco; fronteiras de fuso da organização e filtros intradiários continuam sem prova numérica. Receita por responsável/serviço, aging, competência e demais relatórios sem comparação matemática permanecem NOT_EXECUTED no catálogo, mesmo havendo teste mockado de download.

## F. Defeitos e risco de autorização

### DEF-006 — P1: renegociação de recebível cancelado/baixado

- Reprodução de domínio: recebível CANCELLED ou WRITTEN_OFF, parcela ainda com saldo 100, nova solicitação de renegociação 100. Antes, o serviço retornava `resultingReceivable` e chamava a criação de uma nova dívida.
- Causa confirmada: `FinanceService.renegotiate` não verificava o estado da origem antes de calcular saldo/criar substituto. Origem já renegociada fica CANCELLED, permitindo repetição sequencial com nova referência.
- Teste antes: 2/2 falharam por resolver a promessa em vez de rejeitar. Adaptadores instrumentados; não foi reproduzida duplicação persistida no PostgreSQL.
- Correção local mínima: rejeitar CANCELLED/WRITTEN_OFF com ConflictException. Cinco regressões passaram, incluindo OPEN/PARTIALLY_PAID/OVERDUE preservados. REN-001 fará a validação concorrente e persistida.
- Estado: corrigido no domínio local; integração BLOCKED. Impacto poderia ser crítico se a nova dívida persistisse; não contar P0 de banco como reproduzido.

### DEF-007 — P1: erro de remoção compensatória ignorado

- Reprodução de adaptador: Supabase Storage retorna `{ error }` ao remover arquivo; `StorageService.remove` resolvia `undefined`.
- Causa confirmada: retorno do SDK descartado. Chamadores podiam acreditar que a compensação fora concluída, deixando objeto privado retido.
- Antes: 1/2 testes falhou por promessa resolvida no erro; depois: 2/2 passaram. Correção: verificar error e retornar ServiceUnavailableException, como upload/download já fazem.
- Estado: erro passa a ser visível; não foi demonstrada remoção real nem recuperação automática de falha persistente. ROLLBACK-UPLOAD prepara duas provas com Storage real. Nenhuma fila de limpeza foi inventada; procedimento de reconciliação/retentativa de órfãos continua lacuna operacional.

### RISK-FIN-RLS-001 — potencial P0, ainda não reproduzido

`tenant_update` permite UPDATE de payments/expenses a quem possui a permissão granular. Financeiro tem essas permissões. A API exige administrador para estorno e aprovação independente para despesas, mas `protect_confirmed_payment` protege campos de identidade sem bloquear toda mudança de status. Hipótese concreta: REST direto altera status sem compensação, separação de funções ou auditoria. RLS-WRITE exige que isso seja negado e registra antes/depois mesmo se houver bypass. Não remover esse teste para obter CI verde.

Não foram alteradas migrations/policies neste ponto: restringir DML direto em tabelas financeiras afeta contratos de acesso e precisa de reprodução PostgreSQL e revisão. Ver `PROPOSTA_RLS_FINANCEIRO_ETAPA3.md`. Contagem honesta: **dois defeitos reproduzidos localmente; zero P0 reproduzido em banco nesta etapa; um risco potencial P0 pendente**.

## G. Cobertura e execução

- Candidatos originais preservados: 213. Finance/reports mapeados: 71/71.
- Funcionalidades financeiras únicas determinadas neste recorte: 28 (14 operacionais e 14 relatórios). Não é o total do produto.
- Classificações de funcionalidade: PASS 0; FAIL 0 após correções locais limitadas; PARTIAL 16; NOT_EXECUTED 12; BLOCKED 0 no catálogo agregado. Isso é distinto dos **30 cenários novos integrados BLOCKED** por infraestrutura/publicação. As funcionalidades parciais podem ter subcenários bloqueados.
- Provas locais novas de produto: duas funcionalidades (FIN-008/FIN-014), sete regressões (5+2) após falhar pelos motivos corretos. Não transformar cada parâmetro em funcionalidade.
- Vitest executado após correções: **284/284** (222 API + 42 web + 20 shared). Testes Node do harness: **16/16**, sem rede; incluem configurações inseguras recusadas, arquivos env e payloads validados pelos schemas compilados reais.
- Playwright `--list`: 15 testes em dois arquivos; isso prova descoberta/sintaxe, **não execução integrada**. O relatório gerado pela listagem foi preservado como `evidencias-etapa3/playwright-list-only.json`; o artefato rastreado na raiz foi reposto ao conteúdo de HEAD, com finais de linha nativos do checkout, pois a alteração era produzida por esta etapa.
- Execução direta sem configuração descartável foi recusada com exit 1 antes de abrir conexão. Não há PASS de concorrência/rollback/RLS novo a partir disso.
- Format check, lint, TypeScript, Prisma Validate, builds API/web e `git diff --check` passaram. O format check padrão verifica arquivos versionados; os arquivos novos e o contexto foram verificados também por Prettier explícito. Resultados e hashes estão em `VALIDACAO_ETAPA3.json`. Nenhum resultado da CI histórica foi atribuído ao código modificado.

## Classificação da etapa 3

Todas as linhas usam snapshot `20646dc + alterações locais desta etapa`; ambiente novo real descartável ainda não executado. Evidências históricas são explicitamente separadas.

| Item                     | Status  | Evidência/limite                                                                                                      |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------- |
| FINANCIAL_CONCURRENCY    | BLOCKED | CEN-001…007 preparados; sem PostgreSQL novo                                                                           |
| PAYMENT_IDEMPOTENCY      | PARTIAL | PASS histórico Quality 41850303146, somente cenários de comprovante; novas chaves/saldos concorrentes pendentes       |
| PAYMENT_REVERSALS        | PARTIAL | Domínio e testes unitários existentes; REV/COR/rollback reais pendentes                                               |
| EXPENSE_CONCURRENCY      | BLOCKED | Transições/locks inspecionados, casos reais preparados                                                                |
| FINANCIAL_ROLLBACK       | PARTIAL | Erro de compensação reproduzido/corrigido no adaptador; atomicidade PostgreSQL nova pendente                          |
| FINANCIAL_RLS            | PARTIAL | RLS histórico aprovado no escopo anterior; tentativa direta de alteração econômica nova pendente e risco potencial P0 |
| FINANCIAL_REPORTS        | PARTIAL | Transformação local/Decimal; ground truth SQL/CSV novo não executado                                                  |
| FINANCIAL_DATA_INTEGRITY | PARTIAL | DEF-006/007 locais; persistência e isolamento desta mudança não homologados                                           |
| FUNCTIONAL_COVERAGE      | PARTIAL | 71 candidatos relacionados a 28 funções; total global indeterminado                                                   |
| INTEGRATED_QA            | BLOCKED | Nenhum novo Quality; falta autorização para publicar a rodada descartável                                             |
| PRODUCTION_GO_NO_GO      | FAIL    | NO-GO mantido                                                                                                         |

## H. Próxima execução e autorização

1. Revisar o diff consolidado: duas correções pequenas de produto, suas regressões, um orquestrador integrado e ferramentas/documentação. Não houve mudança de workflow ou migration. O próprio Quality existente descobre a nova suíte; artefatos são gravados em `workflow-stages/financial-stage3.json`, já coberto pelo upload atual.
2. Autorizar especificamente commit/push na branch de validação, mantendo blockers Vercel e PR draft, para executar a candidata completa com o banco descartável. Não usar workflow_dispatch que pule os jobs; evento de PR inclui integração. Nenhum desses comandos foi executado nesta etapa.
3. Priorizar a evidência de RLS-WRITE. A CI pode revelar bypass real; não prometer verde antes da execução. Se confirmado, registrar P0, preparar restrição de escrita financeira direta e testar API + RLS sem enfraquecer leitura autorizada; solicitar autorização específica para publicação/migration.
4. Depois fechar concorrência, estornos, despesas e rollback por cenário. Não repetir opcionais já aprovados para aumentar contagem.
5. Retomar RG/CIN/CNH: revisão por campo, cancelamento, correção manual, CPF inválido, imagem/PDF e persistência após refresh, duas organizações. Depois contratos/processos e demais candidatos. Documentos reais continuam fora dos testes e da CI.

Homologação hospedada, ClamAV/SMTP reais, callbacks, migrations autorizadas, recuperação de Auth/Storage/Database e aceite permanecem requisitos externos. Nenhuma declaração de prontidão comercial.
