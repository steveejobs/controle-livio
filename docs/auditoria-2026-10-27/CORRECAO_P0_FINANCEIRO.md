# Correção P0 — overview financeiro

Data: 2026-10-27  
Referência preservada: `main` em `919a5accc91bc96dbd87773411668d017f968e35`.

## Resultado

**Overview financeiro: PASS** no cenário reproduzido com `connection_limit=1`, PgBouncer e duas requisições simultâneas. O saldo sintético retornou `BRL 880.0000`, igual ao valor `BRL 880.00` já verificado pelo relatório CSV financeiro. A consulta entre organizações sintéticas foi negada com 404 e um cliente QA sem recebíveis nem pagamentos recebeu listas e saldo vazios.

**Regressão financeira ampliada: PARTIAL.** A correção não escreveu no banco. O teste de duas chaves idempotentes distintas foi adicionado como teste unitário com transações serializadas simuladas; não houve uma nova disputa gravada no PostgreSQL. Pagamento integral, vencimento real no banco, cliente via JWT/HTTP após a correção e crescimento de volume no banco permanecem sem comprovação nesta execução.

## Preservação e escopo

- O checkout estava em `main`, HEAD `919a5accc91bc96dbd87773411668d017f968e35`, com alterações e arquivos não rastreados preexistentes. Nenhuma alteração foi descartada ou restaurada.
- O banco consultado é o Supabase remoto já usado pela execução QA. A documentação existente registra que o projeto também está associado a Vercel Production e Preview. Para esta missão, o harness confirmou o prefixo da organização sintética `qa-workflows-1793141782072-70c057-` antes de consultar o cliente.
- Todas as operações desta missão no banco foram `SELECT`. Não foram alterados registros, Auth, Storage, jobs, configuração, schema ou migrations. Não houve deploy.
- O harness não usa credenciais administrativas, não inicia a API HTTP e não simula um JWT. O ator usado diretamente no serviço continha apenas permissões de leitura.

## Causa raiz demonstrada

O endpoint é `GET /v1/clients/:id/overview`, em `ClientsController.overview`, que delega para `ClientsService.overview`. O serviço carregava o cliente e iniciava onze consultas de seção dentro de um `Promise.all`. Recebíveis eram consultados duas vezes: uma lista limitada a 50 para a resposta e uma leitura sem limite para calcular o saldo completo. As leituras relacionais de parcelas, alocações, ajustes e documentos acrescentam comandos SQL.

`PrismaService` é um provider global único do Nest, não uma instância criada por requisição. A configuração efetiva da conexão usada no benchmark tinha `connection_limit=1`, `pgbouncer=true` e nenhum `pool_timeout` explícito; o erro original do Prisma identifica o timeout padrão de 10 segundos. A outra URL de conexão configurada não foi usada pelo cliente da API.

No código anterior, o erro original ocorria em `Task.findMany` no índice 6 do `Promise.all`; uma segunda requisição falhou em `ClientMessage.findMany` no índice 9. A medição somente leitura reproduziu uma falha isolada em 11,24 s (`P2024`); 55 eventos SQL foram emitidos e a soma das durações reportadas pelo Prisma foi 12,77 s, com média de 232 ms e máximo de 353 ms. Em concorrência 2, seis chamadas do harness anterior falharam com `P2024`, entre 11,39 s e 13,47 s.

As consultas individuais não apontaram um único SQL lento. A evidência aponta para saturação/espera de conexão: várias operações Prisma e as consultas relacionais ficam pendentes ao mesmo tempo num pool de uma conexão; o PgBouncer também recebe ciclos de transação separados por operação. Não foi observada evidência de N+1 proporcional ao número de linhas no fixture pequeno. Não rodei `EXPLAIN ANALYZE`: o limite observado era o tempo de fila/conexão, e não houve consulta individual acima de 1 s na medição final. Índices e schema foram mantidos.

## Correção aplicada

O overview agora faz a checagem do cliente e as onze leituras de seção dentro de uma única transação interativa de leitura. Os filtros por `organizationId`, `clientId`, visibilidade e permissões foram preservados. `Promise.all` foi mantido dentro da transação: o Prisma executa as consultas de uma transação na mesma conexão, uma por vez, evitando a fila de aquisições concorrentes. O ganho vem de reutilizar a conexão/transação entre as leituras, não de ampliar o pool.

Os limites da transação estão explícitos: `maxWait=10 s` e `timeout=10 s`. O primeiro corresponde ao limite de aquisição já observado no pool; o segundo fica acima da chamada isolada medida em 8,28 s. Não houve aumento de `connection_limit` ou de `pool_timeout`. Essa solução segue o comportamento documentado pelo Prisma para consultas em `Promise.all` dentro de uma transação: elas são serializadas porque compartilham uma conexão ([documentação Prisma ORM v6](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions)).

O teste unitário novo de concorrência financeira dispara pagamentos de `70.00` e `40.00`, com chaves de idempotência diferentes, nos dois ordenamentos. Em ambos, somente um pagamento é criado, o outro é rejeitado por saldo insuficiente e a alocação total não passa de `100.00`. O teste simula a serialização transacional; não substitui uma prova concorrente no PostgreSQL.

## Resultados antes e depois

| Cenário                           | Antes                                                                    | Depois                                                            |
| --------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Uma leitura, pool 1               | `P2024` em 11,24 s                                                       | `PASS` em 8,28 s                                                  |
| Duas leituras simultâneas, pool 1 | 6/6 falharam em `P2024` (11,39–13,47 s)                                  | 2/2 `PASS`, 7,77 s e 15,46 s                                      |
| Statements observados             | 55 no caso isolado que falhou; 169 no harness com seis chamadas e falhas | 48 no total para duas chamadas, medidos apenas durante o overview |
| Saldo do fixture QA               | Não retornava por `P2024`                                                | `BRL 880.0000`                                                    |
| Isolamento organizacional         | Não exercitado no benchmark anterior                                     | Cliente da organização irmã QA retorna 404                        |
| Cliente sem financeiro            | Não exercitado no benchmark anterior                                     | `receivables=[]`, `payments=[]`, `outstanding=[]`                 |

As duas chamadas finais ficaram abaixo do limite de aquisição de 10 s para iniciar a transação; a segunda terminou em 15,46 s porque esperou a primeira usar a única conexão. O tempo elevado é um risco operacional remanescente para concorrência maior ou para uma função HTTP com limite curto de execução. A missão não alterou configuração cloud ou limite global de conexão.

### Valores do fixture lido

- Recebível sintético: total original `BRL 1,000.00`.
- Pagamento atual: `BRL 120.00`, `CONFIRMED`; pagamento substituído: `BRL 100.00`, `REVERSED`.
- Alocações mostradas no overview: `BRL 120.00` numa parcela de `BRL 333.33`; as outras parcelas são `BRL 333.34` e `BRL 333.33`.
- Saldo calculado: `BRL 880.0000`. A execução QA anterior confirmou que o CSV de recebíveis vencidos continha `"880.00"`; a igualdade foi conferida com o resultado atual do overview.
- O fixture não tem parcela integralmente quitada nem status vencido comprovado. Um teste unitário com 75 recebíveis em memória cobre linhas abertas, parcial, integral, vencida e limite de 50 linhas na lista; o saldo esperado foi `BRL 73.7500`. Isso valida o cálculo e o limite da lista, não o desempenho de um banco com 75 recebíveis.

## Testes e validações

- `npm run test -w @livio/api -- src/clients/clients.service.test.ts src/finance/finance.service.test.ts`: 23 testes passaram.
- `npm test`: 160 testes passaram (API 118, web 25, shared 17).
- `npm run format:check`: passou.
- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm run db:validate`: passou; schema não foi alterado.
- `npm run build`: passou.
- Benchmark somente leitura `connection_limit=1`, `pgbouncer=true`, concorrência 2, duas chamadas: passou; nenhuma chamada retornou `P2024`.

## Lacunas e riscos restantes

- O benchmark pós-correção chamou o serviço diretamente, não repetiu `GET` via HTTP com JWT sintético. O controller e guards não foram alterados; ainda assim, a jornada HTTP autenticada pós-fix precisa de uma execução em ambiente TEST autorizado.
- O teste de duas chaves concorrentes é unitário, com serialização transacional simulada. Não foi gravado pagamento em PostgreSQL nesta missão.
- Pagamento integral e parcela vencida não existem no fixture consultado; os casos foram verificados em memória, não em registros do banco.
- A lista de recebíveis continua limitada a 50, mas o saldo lê todos os recebíveis do cliente. A leitura duplicada é intencional para preservar o saldo completo; uma futura agregação SQL exigiria teste de equivalência Decimal e deve ser planejada separadamente.
- Duas chamadas passaram; carga maior não foi testada. O pool de uma conexão serializa requisições e a latência máxima observada foi 15,46 s. Não aumentar o pool sem estimar o total de instâncias de API e a capacidade do PgBouncer.
- A validade de pagamento, isolamento total sob RLS e as chaves distintas ainda precisam de prova end-to-end em TEST isolado, sem alterar fixtures preexistentes do banco compartilhado.

## Arquivos alterados nesta missão

- `apps/api/src/clients/clients.service.ts`
- `apps/api/src/clients/clients.service.test.ts`
- `apps/api/src/finance/finance.service.test.ts`
- `tools/qa/benchmark-financial-overview.mjs` (novo)
- `tools/qa/README.md`
- `PROJECT_CONTEXT.md`
- `docs/auditoria-2026-10-27/CORRECAO_P0_FINANCEIRO.md` (este relatório)

Artefatos locais sem IDs de organização/cliente: `test-results/financial-overview-before-single.json`, `test-results/financial-overview-before.json`, `test-results/financial-overview-after-final-single-2.json` e `test-results/financial-overview-final.json`.

## Próximos passos recomendados

1. Repetir o benchmark pelo endpoint HTTP com JWT de um usuário QA sintético, incluindo duas chamadas simultâneas, num ambiente TEST isolado.
2. Executar no PostgreSQL uma disputa de duas chaves idempotentes distintas usando um recebível descartável QA, com evidência transacional e limpeza aprovada.
3. Acrescentar fixtures de pagamento integral e parcela vencida e verificar os relatórios correspondentes.
4. Definir uma meta de latência antes de otimizar a leitura redundante do saldo ou alterar o pool; medir o efeito sobre todas as instâncias da API e o PgBouncer.

Nenhum desses passos foi executado automaticamente nesta missão.
