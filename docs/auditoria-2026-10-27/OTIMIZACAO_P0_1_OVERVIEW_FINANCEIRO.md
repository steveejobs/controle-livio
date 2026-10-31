# Otimização P0.1 do overview financeiro

**Data:** 2026-10-27  
**Resultado geral:** **PARTIAL**  
**Resultado do serviço/latência:** **PASS**  
**HTTP autenticado/JWT/RLS:** **BLOCKED**

## Resumo

A mudança reduziu o overview aquecido de 8,28 s para p50 1,224 s e p95/máximo 1,259 s em dez amostras no serviço. O saldo permaneceu `BRL 880.0000`, as duas requisições concorrentes terminaram sem `P2024` e as leituras do fixture QA confirmaram 404 entre tenants e listas financeiras vazias para um cliente sintético sem movimentação.

A meta de produto de p95 inferior a 2 s foi atingida **no serviço isolado**. A rota HTTP com JWT válido não foi medida, portanto esta missão fica parcial e não declara o endpoint HTTP operacional dentro da meta.

## Preservação e destino

- O trabalho começou em `main`, HEAD `919a5accc91bc96dbd87773411668d017f968e35`, com numerosas alterações e arquivos não rastreados preexistentes. Nada foi restaurado, descartado ou sobrescrito fora dos arquivos listados nesta entrega.
- O harness validou que Supabase Auth e a conexão PostgreSQL correspondem à mesma project ref. O destino foi o pooler Supabase em `aws-0-us-east-2.pooler.supabase.com:6543`, com `connection_limit=1` e `pgbouncer=true`. A documentação de QA anterior associa o projeto atual a Vercel Production e Preview; ele não é um ambiente isolado.
- O benchmark consultou apenas organizações/clientes sintéticos de um run QA antigo. Nenhuma escrita, mudança de Auth/Storage, migration, alteração do schema PostgreSQL, deploy ou configuração cloud foi executada.
- Inspeção somente leitura encontrou 2 organizações QA arquivadas, 7 memberships suspensas e 0 combinações com organização/membership/usuário ativos. Nenhum JWT sintético ativo estava disponível. Os identificadores não são repetidos neste documento.

## Diagnóstico demonstrado

O endpoint é `GET /v1/clients/:id/overview`, atendido por `ClientsController.overview` e `ClientsService.overview`. O `PrismaService` continua sendo singleton da API. A conexão configurada tem pool de uma conexão, usa o endpoint de pool transacional Supabase e não declara `pool_timeout`; o timeout observado antes foi o padrão de 10 s do Prisma.

No artefato P0 anterior, cada overview emitia 24 eventos Prisma, dos quais 21 eram `SELECT`. Cada seção e as relações carregadas geravam comandos independentes. Dentro da transação, uma conexão executava esses comandos em série. Os eventos individuais mediam centenas de milissegundos porque a duração reportada pelo Prisma cobre o intervalo até o banco responder, inclusive o percurso de rede; ela não mede apenas CPU/execução no PostgreSQL. Com cerca de 21 leituras sequenciais e controles de transação, a soma observada se aproximava dos 7,7–8,3 s do serviço. Na concorrência 2, o segundo request ainda precisava esperar a primeira chamada liberar a única conexão.

Isso explica a diferença entre as leituras individuais próximas de 232 ms observadas antes e o total de 8–15 s: o gargalo era o número de idas e voltas enfileiradas/serializadas, agravado pela contenção de um pool de uma conexão. As medições não isolam CPU SQL, TCP/TLS, pooler e fila como parcelas independentes. Não foi feito `EXPLAIN ANALYZE`; não há evidência de uma única consulta SQL originalmente lenta.

O endpoint usa Auth `getClaims` e busca a membership antes do serviço. Esses spans, o guard de permissão, o rate limiter e o total HTTP não foram medidos nesta execução porque não havia JWT QA ativo. Além disso, o guard global de rate limit faz `INSERT ... ON CONFLICT DO UPDATE` em `api_rate_limits` em toda requisição autenticada. Não foi apropriado enviar uma chamada autenticada ao banco compartilhado sem fixture de identidade ativo e autorização para essa escrita sintética.

## Correção aplicada

As seções que já dependiam de permissões são carregadas no `findFirst` do cliente usando `relationLoadStrategy: 'join'`. A linha do tempo de auditoria fica numa segunda leitura dentro da mesma transação: `ActivityEvent.subjectId` é um identificador polimórfico e não possui relação Prisma direta com `Client`. O saldo é calculado pela função existente `calculateOutstandingByCurrency`, sem SQL bruto, mantendo Decimal/string e a precisão de quatro casas.

A relação de recebíveis é carregada uma vez, ordenada por vencimento; os primeiros 50 continuam sendo apresentados, e o cálculo usa todos os recebíveis, assim como antes. Contratos, processos, pagamentos, documentos, tarefas, calendário, notas, mensagens e contatos mantêm os campos, ordenações, limites e condições de permissão existentes. Cada relação e a busca do cliente continuam limitadas por organização/cliente; documentos de cliente continuam filtrados para visibilidade `CLIENT`.

`relationJoins` foi ativado como preview no generator do Prisma 6.19.3 e o client foi regenerado. Isso é uma opção de geração do Prisma, não uma migration ou alteração de estrutura PostgreSQL. A transação segue com limites existentes de `maxWait=10 s` e `timeout=10 s`; pool e timeouts globais não aumentaram.

## Consultas e medições

| Medida do serviço                  |                                   P0 anterior |                       P0.1 final |
| ---------------------------------- | --------------------------------------------: | -------------------------------: |
| Eventos Prisma por chamada         |                                            24 |                                5 |
| `SELECT` por chamada               |                                            21 |                                2 |
| Uma chamada aquecida               |                                       8,281 s |    p50 1,224 s; p95/máx. 1,259 s |
| Duas chamadas concorrentes, pool 1 |                            7,773 s e 15,457 s |                1,219 s e 2,437 s |
| Erros no ensaio                    | P0 corrigia P2024, mas mantinha latência alta | 0/10 aquecidas; 0/2 concorrentes |
| Saldo sintético                    |                                  BRL 880.0000 |                     BRL 880.0000 |

Na amostra aquecida final, o `SELECT` raiz que agrega as relações reportou 346–358 ms por evento e a linha do tempo, 339–353 ms. Cada valor inclui ida e volta cliente-banco. Os 5 eventos por chamada foram `BEGIN`, um comando de protocolo classificado como `OTHER`, o `SELECT` raiz, o `SELECT activity_events` e `COMMIT`. O comando `OTHER` não foi classificado como `SET` ou outra operação específica.

A soma de durações Prisma por chamada aquecida ficou entre 1,195 e 1,215 s. `JSON.stringify` do objeto do serviço levou até 0,3 ms e produziu 4.673 bytes. Essa serialização é apenas local e não mede o adapter HTTP do Nest. A primeira chamada após `$disconnect` levou 2,633 s; o span até o callback iniciar foi 1,567 s, seguido de 0,860 s no callback. O primeiro span inclui aquisição/setup e não pode ser chamado de fila pura do pool.

O p95 usa nearest-rank em dez amostras; por isso coincide com a maior amostra. As dez chamadas foram sequenciais com conexão aquecida; o ensaio concorrente é separado e contém somente duas requisições. Não houve teste de estresse ou aumento de concorrência acima de 2.

O número de eventos caiu 79,2% (24 para 5) e o número de `SELECT` caiu 90,5% (21 para 2). Contra a leitura isolada do P0 anterior, a mediana aquecida caiu aproximadamente 85,2%. A comparação é do serviço e usa o mesmo fixture sintético; não compara rota HTTP.

## Regressão e cobertura

| Cenário                                                    | Resultado       | Evidência/limite                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overview e resposta sem erros                              | PASS            | 10/10 leituras aquecidas e 2/2 concorrentes concluíram; nenhum `P2024`.                                                                                                                                                              |
| Decimal e saldo                                            | PASS            | Todas as amostras retornaram `BRL 880.0000`, sem conversão para ponto flutuante. O relatório QA anterior já tinha conferido o saldo com o CSV financeiro.                                                                            |
| Isolamento entre organizações                              | PASS no serviço | A leitura do cliente usando organização QA irmã retornou 404. Não foi uma chamada autenticada e não comprova RLS.                                                                                                                    |
| Escritório/cliente sem financeiro                          | PASS no serviço | Recebíveis, pagamentos e saldo retornaram vazios.                                                                                                                                                                                    |
| Seleção de contratos/processos e demais seções             | PARTIAL         | A consulta raiz contém essas relações; o escopo unitário, typecheck e builds passaram. Não houve chamada HTTP/frontend ou relatório real nesta execução.                                                                             |
| Mais volume financeiro                                     | PARTIAL         | O teste unitário existente cobre 75 recebíveis em memória, estados parcial/integral/vencido e limite de 50 na apresentação. O banco compartilhado tem apenas o fixture pequeno usado; nenhum dado foi inserido para aumentar volume. |
| HTTP/JWT, Auth, permissões Nest e RLS                      | BLOCKED         | 0 organizações QA ativas, 7 memberships suspensas e nenhum JWT QA válido. O guard de rate limit grava uma linha no PostgreSQL compartilhado; nenhuma requisição autenticada foi enviada.                                             |
| Pagamentos concorrentes com chaves distintas no PostgreSQL | BLOCKED/NOT_RUN | Não foram criados dados nem renovada identidade no banco compartilhado. O teste unitário transacional dos dois ordenamentos continua sendo simulação; não substitui prova no PostgreSQL.                                             |
| Queries de relatório e pagamento integral/vencido reais    | NOT_RUN         | Nenhuma regressão HTTP nesses endpoints e nenhum fixture adicional foi criado.                                                                                                                                                       |

O fixture QA atual retornou um recebível e dois pagamentos no overview. A resposta JSON do serviço foi serializada para conferir a estrutura em memória, mas o frontend não foi executado contra uma resposta autenticada desta versão. O sistema não deve ser declarado operacional de ponta a ponta com base neste benchmark isolado.

## Testes e validações

- `npm run test -w @livio/api -- src/clients/clients.service.test.ts src/finance/finance.service.test.ts`: 23 testes passaram.
- `npm test`: 160 testes passaram (118 API, 25 web, 17 shared).
- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm run format:check`: passou.
- `npm run db:validate`: passou. Não houve migration.
- `npm run build`: passou para API, UI e web.
- Benchmark remoto, somente leitura: 10 aquecidas, 2 concorrentes; serviço PASS, isolamento do fixture PASS, cliente vazio PASS, missão geral PARTIAL por HTTP BLOCKED.

## Riscos remanescentes e próxima prioridade

1. Habilitar um usuário/membership QA sintético ativo em um ambiente explicitamente autorizado para executar o teste HTTP com JWT e medir `getClaims`, membership/permissões, rate limit, serviço e resposta HTTP em separado. O guard grava em `api_rate_limits`; o teste precisa identificar o hash exclusivo do usuário sintético, confirmar que ainda não existe e limpar apenas essa linha criada pelo run após a janela, sem alterar linhas preexistentes.
2. Repetir concorrência 1 e 2 pelo HTTP, validar a resposta consumida pelo frontend, repetir isolamento entre tenants por JWT/RLS e executar chamadas de relatório/financeiro sem escrita.
3. Avaliar o overview com muitos recebíveis em fixture sintético de TEST isolado. A query carrega todas as parcelas/alocações/ajustes para calcular o saldo; o tempo/payload do fixture atual não prova comportamento em alto volume. Se essa medição mostrar crescimento inadequado, comparar uma agregação SQL parametrizada e cuidadosamente testada com o cálculo Decimal existente.
4. Depois que identidade e destino de teste estiverem disponíveis, executar a corrida de pagamentos com duas chaves idempotentes distintas em um recebível descartável QA PostgreSQL e confirmar que a soma alocada nunca excede o saldo.

## Arquivos alterados nesta missão

- `apps/api/src/clients/clients.service.ts`
- `apps/api/src/clients/clients.service.test.ts`
- `packages/db/prisma/schema.prisma` (feature preview do client Prisma; sem alteração PostgreSQL)
- `tools/qa/benchmark-financial-overview-optimized.mjs`
- `tools/qa/README.md`
- `PROJECT_CONTEXT.md`
- `docs/auditoria-2026-10-27/OTIMIZACAO_P0_1_OVERVIEW_FINANCEIRO.md`
- Artefatos somente leitura em `test-results/`: `financial-overview-optimized-20261027.json`, `financial-overview-join-20261027.json`, `financial-overview-optimized-transaction-20261027.json` e `financial-overview-optimized-final-20261027.json`.

Nenhum deploy, migration, alteração cloud ou operação de escrita no banco foi executada.

## Referências técnicas

- Prisma documenta que a estratégia `join` monta relações no banco em uma única consulta e a disponibiliza sob o preview `relationJoins`: [Prisma ORM — estratégia join vs. query](https://www.prisma.io/blog/prisma-orm-now-lets-you-choose-the-best-join-strategy-preview).
- A duração do evento de consulta Prisma é o intervalo até o banco responder, não somente execução SQL: [Prisma Client API v6](https://www.prisma.io/docs/orm/v6/reference/prisma-client-reference).
- Supabase distingue pooler transacional compartilhado de conexão direta e recomenda escolher o pool conforme runtime e concorrência: [conexão PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres) e [pooling e limites](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits).
