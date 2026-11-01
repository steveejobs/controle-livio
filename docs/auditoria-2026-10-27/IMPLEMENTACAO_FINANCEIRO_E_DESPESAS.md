# Consolidação financeira e implementação de despesas

**Data:** 2026-10-27  
**Estado geral:** **PARTIAL**

## Resumo

O overview financeiro e a disputa de pagamentos foram executados pela API local com autenticação JWT e PostgreSQL real, usando duas organizações e identidades QA sintéticas. Não houve Prisma `P2024`, pagamento acima do saldo, alocação duplicada ou acesso entre organizações. O rate limit permaneceu ativo. A rota autenticada ainda não atinge o objetivo de p95 inferior a 2 s.

O ciclo de despesas foi implementado no código da API e da interface e possui cobertura unitária. Para suportá-lo, a migration `20261027150000_expense_workflow` foi preparada, mas **não aplicada**. Por isso, o ciclo de despesas, seus relatórios integrados no banco e a interface conectada à API continuam sem validação integrada e não devem ser considerados operacionais no banco atual.

Nenhum deploy, migration, alteração de schema no banco, alteração em registro preexistente ou cópia de dados foi realizada. O checkout já tinha um working tree extenso; as alterações existentes foram preservadas.

## 1. Validação financeira no PostgreSQL real

### Destino e proteção

- Auth, PostgreSQL e Storage foram identificados como pertencentes ao mesmo projeto Supabase. A ref também está conectada aos ambientes Vercel Production e Preview; portanto, a infraestrutura não é independente de produção. A execução ocorreu somente após a autorização explícita do proprietário para dados sintéticos no banco atual.
- O preflight confirmou três buckets privados, RLS habilitada e forçada em 13 de 13 tabelas da matriz QA, cadastro público desabilitado, zero assinaturas push e ausência de credenciais externas no processo de teste. O agendador `pg_cron` estava ativo; a execução não criou tarefas, audiências, notificações vencidas nem dados que acionassem essa rotina.
- As chamadas HTTP passaram pelo escopo de organização da API. O PostgreSQL usado pela aplicação recebe consultas Prisma do servidor; esta execução não simulou o papel do usuário final diretamente no PostgreSQL e, portanto, confirma a configuração de RLS no catálogo, mas não a aplicação efetiva das policies nesse caminho.
- Duas organizações e duas identidades financeiras sintéticas foram criadas para esta execução. O serviço administrativo do Supabase foi usado apenas para provisionar e encerrar essas identidades. Chamadas da API foram feitas com JWTs de sessão. Rate limit ativo; o contador foi criado para o usuário/organização QA e não substituiu contador preexistente.
- A limpeza arquivou as duas organizações desta execução, suspendeu suas memberships e usuários e baniu as duas contas Auth. Perfis sintéticos, auditoria e o contador técnico QA foram mantidos como evidência. Nenhum registro preexistente foi modificado.

### Overview HTTP autenticado

Foi exercitada a rota `GET /clients/:id/overview` por HTTP com autenticação, membership ativa, permissão do perfil financeiro, guard global, rate limit, Prisma e serialização JSON.

| Amostra                            |           Resultado |
| ---------------------------------- | ------------------: |
| Inicialização fria                 |            3.273 ms |
| 10 leituras aquecidas — p50        |            2.589 ms |
| 10 leituras aquecidas — p95/máximo |            2.755 ms |
| 2 leituras concorrentes            | 4.280 ms e 5.130 ms |
| P2024 / respostas HTTP de overview |             0 / 200 |

O baseline anterior do serviço isolado era p50 1,224 s e p95 1,259 s. O HTTP autenticado ficou acima do objetivo de produto de p95 <2 s. A sessão mediu o tempo completo e confirmou autenticação, rate limit e respostas, mas não instrumentou separadamente Auth, guards, fila/conexão Prisma, rede e serialização Nest. Portanto, a diferença não é atribuída a uma camada específica. O caso de cliente sem movimentações não foi repetido via HTTP nesta execução; ele tem cobertura anterior somente no serviço.

### Pagamentos concorrentes e isolamento

Duas requisições `POST /finance/payments`, com chaves de idempotência distintas, disputaram em concorrência 2 o mesmo saldo sintético de BRL 100,0000 no PostgreSQL real.

- Uma requisição foi confirmada (`201`) e a outra rejeitada (`400`).
- Uma única cobrança de BRL 65,0000 foi confirmada e uma única alocação ativa de BRL 65,0000 foi persistida.
- O saldo remanescente foi BRL 35,0000; nenhuma alocação duplicada ou pagamento acima do saldo foi observado.
- A disputa terminou em 9.496 ms. Esse tempo é alto para uma única operação financeira e merece acompanhamento, mas não houve teste de carga agressivo.
- O relatório HTTP `/reports/received` retornou sucesso e BRL 65,00 recebidos; o saldo do overview após pagamento permaneceu BRL 35,0000. A resposta do relatório usa duas casas decimais, enquanto os valores persistidos e alocados foram verificados com quatro casas.
- Um JWT de outra organização recebeu `404` ao consultar o cliente sintético. Nenhum dado do cliente foi retornado.

### Evidência

- Execução: `test-results/qa-financial-http-1793151156330-be7cdb.json`.
- Log local da API: `test-results/qa-financial-api-1793151156330-be7cdb.log`.
- Harness: `tools/qa/validate-financial-http.ts`.
- O artefato tem status geral `PARTIAL` porque o ciclo HTTP de despesas está bloqueado pela migration pendente. O teste não transforma esse bloqueio em aprovação.

## 2. Ciclo de despesas implementado no código

### API, transições e permissões

O módulo `finance` existente foi ampliado; não foram criados banco, Supabase ou tabelas paralelas. Rotas adicionadas ou completadas:

| Operação                           | Rota                                                       | Permissão                              |
| ---------------------------------- | ---------------------------------------------------------- | -------------------------------------- |
| Criar e listar                     | `POST/GET /finance/expenses`                               | `expenses:create` / `expenses:view`    |
| Listar responsáveis e ler política | `GET /finance/expenses/responsibles`, `/approval-policy`   | `expenses:view`                        |
| Atualizar política                 | `PATCH /finance/expenses/approval-policy`                  | `organization:update` e administrador  |
| Editar                             | `PATCH /finance/expenses/:id`                              | `expenses:update`                      |
| Enviar, aprovar, rejeitar          | `POST /finance/expenses/:id/submit`, `/approve`, `/reject` | `expenses:update` / `expenses:approve` |
| Registrar pagamento e cancelar     | `POST /finance/expenses/:id/payment`, `/cancel`            | `expenses:update`                      |
| Resumo                             | `GET /finance/expenses/summary`                            | `expenses:view`                        |

As transições propostas são `DRAFT → PENDING_APPROVAL → APPROVED → PAID` quando aprovação é obrigatória e `DRAFT → APPROVED → PAID` quando ela é desativada. A configuração fica em `Organization.settings`; na ausência de configuração, aprovação é obrigatória. A mudança da política só pode ser feita por administrador e é auditada.

Rejeição exige motivo. O criador não pode aprovar a própria despesa. Uma despesa rejeitada volta a `DRAFT` quando editada; despesas aprovadas, pagas ou canceladas não podem ser editadas. Cancelamento é permitido apenas antes de pagar; pagar exige estado `APPROVED`, valor Decimal igual ao total e quitação integral. Repetição, pagamento parcial, sobrepagamento e pagamento de estado inválido são recusados. O pagamento registra `paidAt`; valor, forma e referência ficam na trilha de auditoria. O registro é manual e não aciona provedor financeiro.

Criação exige vencimento. Edição não permite remover o vencimento; registros históricos que já não tenham data continuam legíveis. Valor segue string/Decimal e moeda é normalizada para código de três letras. Cliente, processo e responsável são validados dentro da organização; o responsável deve ter membership ativa. Listagem suporta status, categoria, cliente e intervalo por vencimento, data de ocorrência ou pagamento. O resumo e o fluxo de caixa agrupam por moeda, sem somar BRL com USD.

Operações de criação, edição, envio, decisão, pagamento, cancelamento e alteração da política são auditadas em `AuditLog` dentro da transação. O histórico usa essa auditoria existente; não foi adicionada tabela de histórico. Documentos associados usam o relacionamento existente `Document.expenseId` e o fluxo atual de armazenamento privado.

### Tratamento explícito de pagamentos parciais e reembolsos

- **Pagamento parcial:** não suportado. Uma despesa só pode ser marcada como paga quando o valor informado é exatamente igual ao total. Não há pagamentos em parcelas nem saldo restante de despesa.
- **Reembolso:** a flag existente `reimbursable` é apenas informativa. Ela não cria recebível, não registra reembolso recebido e não entra como receita ou caixa positivo. A interface foi rotulada para não sugerir que uma cobrança já foi criada.
- A forma e referência de pagamento ficam na auditoria, não em um razão de pagamentos independente. Reembolso processado, estorno, rateio e conciliação não estão implementados.

### Interface

A tela financeira existente passou a oferecer formulário de criação, responsável, vínculo opcional a cliente/processo, vencimento, edição em rascunho/rejeição, política de aprovação, envio, aprovação/rejeição, quitação integral, cancelamento, anexos, filtros e resumo por status/moeda. Ações são condicionadas às permissões disponíveis e os estados de erro/sucesso são exibidos. A interface foi compilada, mas não foi executada contra o banco porque a migration ainda não está aplicada.

## 3. Relatórios

- O relatório **recebido** permanece baseado somente em pagamentos confirmados, distinto do saldo de recebíveis pendentes. Sua rota foi exercitada por HTTP no teste financeiro.
- `cash-forecast` subtrai despesas aprovadas previstas de recebíveis previstos por período e moeda.
- `cash-flow` separa recebimentos confirmados, despesas pagas, recebíveis previstos, despesas aprovadas previstas e despesas pendentes de aprovação.
- `cash-flow-by-client` usa alocações ativas e despesas pagas associadas ao cliente/processo.
- Valores dos novos relatórios são serializados com quatro casas decimais. A interface escolhe a moeda indicada em cada linha.
- Os SQLs de `cash-flow` e `cash-flow-by-client` também foram executados em modo somente leitura, diretamente no serviço e limitados a uma organização sintética arquivada. O primeiro retornou BRL 65,0000 recebido, BRL 65,0000 de caixa líquido e zero de despesas pagas/previstas; o segundo retornou uma linha sintética. Essa verificação não usou JWT nem validou despesas, pois a organização não tinha fixtures de despesas. Evidência: `test-results/qa-cash-flow-readonly-1793151156330-be7cdb.json`.
- A conferência integrada do ciclo de despesas, seus estados e relatórios com despesas continua bloqueada pela migration pendente.

## 4. Validações executadas

- `npm test`: **171 testes aprovados** (129 API, 25 web, 17 shared).
- `npm run lint`: aprovado, sem avisos.
- `npm run format:check`: aprovado.
- `npm run typecheck`: aprovado para API e web.
- `npm run db:validate`: aprovado para o schema Prisma local.
- `npm run build`: API, UI e Next.js aprovados.
- Testes direcionados de despesas, schemas e relatórios: 33 aprovados.
- O primeiro `npm test` após exigir vencimento expôs que `z.coerce.date()` aceitava `null`; a validação foi ajustada para rejeitar `null`, o teste direcionado passou e a suíte completa final passou.
- **Não executados:** migration em banco, testes HTTP de despesas, navegação Playwright conectada à API, relatório de despesas no banco, interface operacional de despesas e teste de volume crescente. Não houve deploy.

## 5. Schema pendente e riscos

`packages/db/prisma/migrations/20261027150000_expense_workflow/migration.sql` acrescenta o valor `REJECTED` ao enum, campos de responsável/envio/rejeição e índices/FKs correspondentes. A migration é necessária para as novas rotas e relações. Foi validada somente contra o schema Prisma local; não foi aplicada nem testada no PostgreSQL. Por se tratar da infraestrutura atual conectada a Production/Preview, a mudança de schema exige aprovação explícita do destino e procedimento autorizado antes de qualquer aplicação.

Riscos e limites observados:

1. O p95 HTTP de 2.755 ms excede o objetivo de 2 s; ainda não foi feita decomposição temporal por camada.
2. Duas leituras HTTP concorrentes chegaram a 5.130 ms e a disputa de pagamento levou 9.496 ms. A evidência comprova correção da disputa nessa amostra, não capacidade sob carga.
3. Não foi repetida via HTTP a resposta vazia para cliente sem movimentações ou a leitura de volume crescente.
4. O ciclo de despesas não pode ser considerado operacional até aprovação/aplicação da migration num destino autorizado e teste das rotas e UI com JWTs reais por papel.
5. Categorias continuam texto livre; não há catálogo de categorias, pagamentos parciais, reembolso, estorno ou livro auxiliar de pagamentos de despesas.
6. Anexos e relatórios de despesas permanecem sem prova integrada nesta execução.
7. O projeto atual continua conectado a Production/Preview. A autorização cobriu somente registros sintéticos identificados por esta execução; não transforma esse projeto em TEST.

## 6. Próxima etapa por módulo

| Classe         | Módulo                          | Próxima ação                                                                                                       | Teste de aceite                                                                                                                                         |
| -------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MANTER**     | Clientes e financeiro existente | Preservar Decimal, escopo por tenant, idempotência e transações                                                    | Repetir o QA financeiro em baixa concorrência e manter uma única alocação quando duas chaves disputarem o saldo                                         |
| **CORRIGIR**   | Latência do overview            | Instrumentar tempos de Auth, guards, espera/transação Prisma, SQL e serialização HTTP antes de otimizar            | 10 leituras aquecidas, p95 <2 s no ambiente definido, zero P2024 e comparação do mesmo cliente/fixture                                                  |
| **COMPLETAR**  | Despesas                        | Obter autorização para migration, aplicá-la somente no destino aprovado e executar fluxo fim a fim                 | Criar com vencimento; filtrar; rejeitar e editar; aprovar por outro usuário; pagar integralmente; auditar; confirmar saldo/relatório e isolamento       |
| **COMPLETAR**  | Documentos de despesas          | Validar upload privado, vínculo, visibilidade e download por papel                                                 | JWT autorizado baixa; usuário/tenant sem vínculo recebe negação; hash e metadados correspondem                                                          |
| **COMPLETAR**  | Relatórios                      | Executar novos relatórios sobre dados de múltiplas moedas e despesas de estados diferentes                         | Recebido contém apenas pagamentos confirmados; caixa real contém despesas pagas; previsão contém somente estados previstos; nenhum total mistura moedas |
| **DECIDIR**    | Financeiro                      | Confirmar se categorias são texto livre ou catálogo e se reembolso/parcial/estorno serão suportados                | Decisão de produto documentada antes de modelar razão, saldos e conciliação                                                                             |
| **CRIAR**      | Razão de pagamentos de despesas | Criar somente se o produto exigir parcelas, estorno ou conciliação independente da auditoria                       | Cada pagamento com valor/data/moeda referenciado; soma não excede total; estorno não apaga histórico                                                    |
| **REDESENHAR** | Caixa por cliente/processo      | Revisar definição de atribuição das despesas sem cliente/processo e apresentação de previsões e despesas pendentes | Usuário distingue valores recebidos, previstos, aprovados, em aprovação e pagos em cada moeda                                                           |

Nenhuma ação dessa matriz foi executada automaticamente.

## 7. Arquivos alterados nesta missão

- API: `apps/api/src/finance/finance.controller.ts`, `finance.schemas.ts`, `finance.schemas.test.ts`, `finance.service.ts`, `finance.service.test.ts`, `apps/api/src/reports/report.schemas.ts`, `reports.controller.ts`, `reports.service.ts`, `reports.service.test.ts`.
- Banco local: `packages/db/prisma/schema.prisma` e migration pendente `packages/db/prisma/migrations/20261027150000_expense_workflow/migration.sql`.
- Interface: `apps/web/features/finance/finance-operations.tsx`, `apps/web/features/reports/reports-center.tsx`, `apps/web/theme/operations.css`.
- QA/documentação: `tools/qa/validate-financial-http.ts`, `tools/qa/README.md`, este relatório e `PROJECT_CONTEXT.md`.
- Evidências geradas: JSON da execução e log da API indicados acima.
