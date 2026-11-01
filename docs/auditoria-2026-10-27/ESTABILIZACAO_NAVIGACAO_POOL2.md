# Estabilização da navegação com pool Prisma 2

**Data:** 2026-10-28  
**Resultado:** `PARTIAL` — correção de telemetria confirmada; navegação completa com pool 2 continua instável.  
**Deploy, migrations e mudanças de configuração cloud:** não executados.

## Resumo

`connection_limit=2` foi aplicado apenas ao processo local da API, mantendo `pool_timeout=10`. A configuração foi exercitada com um processo Nest e Supabase Supavisor em modo transacional, porta 6543. Uma navegação autenticada de uma sessão conseguiu abrir dashboard, clientes e processos, mas a tela Financeiro/Despesas iniciou várias leituras distintas em paralelo e provocou quatro consultas aguardando no pool, dez chamadas HTTP ainda sem resposta e interrupção do cenário em 23,65 s. O maior p95 entre as nove respostas concluídas foi 4,52 s. Não houve P2024.

Uma tentativa limitada anterior com duas sessões do mesmo administrador QA atingiu oito consultas aguardando em 1,38 s e foi interrompida. Nenhum cenário de três sessões ou jornada com escrita foi iniciado depois desses sinais. Portanto, pool 2 não está validado para navegação estável nem para publicação.

## Estado e preservação

- Branch `main`, HEAD `919a5accc91bc96dbd87773411668d017f968e35`. O working tree já estava extensamente alterado; não houve reset, descarte de arquivos, migration, deploy ou alteração Vercel.
- Projeto remoto identificado como `ioebcdpyrszokdyaoaqv`, associado a Production/Preview. O teste reutilizou somente um administrador e uma organização QA sintéticos já existentes.
- O API filho recebeu `connection_limit=2`; `pool_timeout` permaneceu em dez segundos. O processo Nest foi único e carregou de um CWD temporário sem `.env`, sem credenciais de SMTP, push, cron, pagamentos ou integrações externas.
- Signup Auth estava desativado, não havia assinaturas push para o tenant QA e as requisições usaram JWT real do administrador sintético, com autenticação, permissões e rate limit ativos.
- A comparação antes/depois confirmou iguais as contagens de clientes, contatos, processos, contratos, recebíveis, parcelas, pagamentos, alocações, despesas, documentos, versões, tarefas, eventos, notificações, mensagens e histórico de etapas.
- Como esperado, o login e a telemetria produziram registros técnicos: `activity_events` passou de 22 para 29; os contadores sintéticos de rate limit foram atualizados e `users.lastLoginAt` foi atualizado pela autenticação. Nenhum registro jurídico ou financeiro foi criado ou alterado. Não houve envio de e-mail, push, webhook ou cobrança.
- `pg_stat_activity` mostrou 8 conexões visíveis/1 ativa antes e 10/1 depois; `max_connections=60` e 3 reservadas. O contador não identifica quais sessões pertencem ao Supavisor/API e não comprova limite do pooler. Nenhum processo local da API ou Next do runner permaneceu ativo após a execução.

## Diagnóstico de pool e latência

O `PrismaService` da API permanece singleton. Não foi encontrado ciclo de vida que criasse um PrismaClient por requisição. O runner encerra seu PrismaClient de preflight antes de subir a API. O alvo local usa Supavisor transaction pooler pela porta 6543, e não o pool de sessão 5432.

A causa imediata da fila foi confirmada pelo gauge Prisma: com duas conexões abertas e ocupadas, requisições adicionais aguardaram. A tela financeira iniciou simultaneamente sete GETs diferentes (`receivables`, `payments`, `payments/change-requests`, `expenses`, `expenses/approval-policy`, `expenses/summary` e `expenses/responsibles`), além de leituras de clientes/processos e telemetria. Esses endpoints não eram chamadas repetidas da mesma rota; eram consultas distintas da tela.

Cada rota autenticada também faz uma leitura relacional de membership/permissões no `AuthenticationGuard`, uma gravação atômica do rate limit no PostgreSQL e a operação do handler. Nas nove respostas completas da navegação solo, os tempos `Server-Timing` p95 foram:

| Fase medida                        | Amostras |      p95 |
| ---------------------------------- | -------: | -------: |
| Claims JWT/Auth                    |        9 |    21 ms |
| Membership e permissões via Prisma |        9 | 1.891 ms |
| Rate limit persistido via Prisma   |        9 | 1.726 ms |
| Guard de permissão                 |        9 |     0 ms |
| Handler                            |        9 | 1.739 ms |
| Evento de consulta Prisma          |      117 |   521 ms |

Os tempos de membership/rate limit incluem aquisição de conexão, ida ao pooler, execução e retorno; a instrumentação atual não separa totalmente essas parcelas. O histograma Prisma acumulou 3.596 ms de espera no cenário solo. A evidência aponta fan-out concorrente sobre um pool curto e roundtrips remotos por rota, não uma consulta SQL isolada anormalmente lenta nem invalidação por telemetria. No log completo da API, os eventos `BEGIN` tiveram p95 de 182 ms (47 eventos), `COMMIT` p95 de 174 ms (45 eventos) e a gravação `INSERT` do rate limit p95 de 455 ms (14 eventos); não há medição de span que permita afirmar duração total de transações. Não se confirmou N+1 nas leituras concluídas de clientes/processos; os sete GETs financeiros não responderam antes do corte, então o trabalho SQL interno desses handlers não foi avaliado.

## Navegação e cache

### Uma sessão

Execução `qa-navigation-pool2-1793220919634-6c9391`:

- Duração até interrupção: 23.652 ms.
- 19 chamadas API observadas; 9 responderam (4 HTTP 200 e 5 HTTP 201); 10 continuavam incompletas quando o guard de segurança encerrou o cenário.
  Rotas com resposta na navegação (uma amostra por rota; p95/máximo não são estatisticamente estáveis):

| Rota                                               |                             Resultado |     Duração |
| -------------------------------------------------- | ------------------------------------: | ----------: |
| `GET /v1/dashboard/summary` (carregamento inicial) |                         HTTP 200, n=1 |    5.833 ms |
| `GET /v1/clients`                                  |                         HTTP 200, n=1 |    3.672 ms |
| `GET /v1/clients/:id/overview`                     |                         HTTP 200, n=1 |    3.492 ms |
| `GET /v1/matters`                                  |                         HTTP 200, n=1 |    4.190 ms |
| `GET /v1/pipelines`                                |                         HTTP 200, n=1 |    4.518 ms |
| Financeiro/Despesas: sete GETs distintos           | Sem resposta antes do corte, n=1 cada | Incompletos |

- Latência das respostas completas: p50 3.660 ms, p95/máximo 4.518 ms, 9 amostras.
- Máximo no pool: 4 aguardando, 2 ocupadas/abertas; nenhum P2024.
- Consultas Prisma: 117 eventos, p50 173 ms, p95 521 ms, máximo 528 ms.
- Clientes, dashboard e processos abriram. Ao entrar em Financeiro/Despesas, as chamadas listadas acima ficaram sem resposta antes do corte. Documentos e tarefas não foram alcançados.
- O cenário completo foi marcado FAIL por fila, não por rejeição funcional dos endpoints. Não se aguardou o `pool_timeout=10` para provocar um P2024: as páginas e os processos locais foram encerrados ao atingir o limite de segurança.

### Duas sessões

Execução `qa-navigation-pool2-1793220589241-6d91c2`, duas sessões de browser autenticadas como a mesma identidade QA:

- A navegação inicial de clientes/cache passou: 6 chamadas, p50 2.877 ms, p95/máximo 4.004 ms; nenhuma pendente e máximo de duas requisições simultâneas no browser.
- Ao prosseguir juntas por Clientes e Processos, a fila chegou a 8 consultas em espera em 1.376 ms, com 8 chamadas pendentes quando interrompido. A amostra de respostas encerradas era insuficiente para calcular p95; zero P2024 foi observado antes do corte.
- O ensaio não representa dois usuários com chaves de rate limit distintas; não houve terceira sessão. O teste mais completo de uma sessão já falhou na tela financeira, então a progressão foi suspensa.

### Invalidação de cache e seleção do cliente

O browser real observou três POSTs `module-views`, um POST `client-views`, somente um GET `/clients` na primeira visita, nenhum GET repetido ao voltar à lista e zero refetch da lista causado pela telemetria. Os eventos de telemetria mantêm sua gravação; a checagem comprova apenas que não invalidam GETs de negócio.

Não existe amostra browser anterior ao ajuste de cache com o mesmo percurso e a mesma conta para uma comparação quantitativa antes/depois; os dados acima comprovam o comportamento atual, sem atribuir uma redução numérica à correção.

Foi corrigido um defeito real de integração: ao abrir uma linha de cliente, `ClientManagement` selecionava o registro internamente, mas `LegalCrm` não recebia o `clientId`; assim o evento `client-views` não era enviado. O callback agora propaga o ID por `openClient(id)`. Playwright verificou o POST e o corpo correspondente. A alteração não muda regras de negócio nem cache de mutações.

## Comparação pool 1/2/3 e limites da comparação

No benchmark somente leitura comparável, cada configuração executou 9 consultas `pg_sleep(80ms)` com 3 concorrentes:

| Pool |      p50 | p95/máximo | Pico aguardando | Espera acumulada Prisma |
| ---: | -------: | ---------: | --------------: | ----------------------: |
|    1 | 1.843 ms |   2.773 ms |               2 |                8.286 ms |
|    2 |   942 ms |   2.165 ms |               2 |                2.815 ms |
|    3 |   925 ms |   2.172 ms |               2 |                  1,8 ms |

O pool 2 melhorou esse microbenchmark frente ao pool 1; o pool 3 não melhorou o p95 frente ao 2. O resultado não prova navegação da aplicação. No browser, o pool 1 anterior chegou a 13 aguardando, 16 respostas concluídas e 4 requisições ainda pendentes após 45 s. As navegações browser de pool 1 e 2 não são diretamente comparáveis: os percursos, duração e critérios de corte diferem. Os resultados reais do pool 2 acima mostram que a melhoria do microbenchmark não basta para estabilidade da UI.

## Vercel e orçamento de conexões

`apps/api/vercel.json` define `fluid: true`, região `cle1` e cron; não define um máximo explícito de instâncias. A leitura `vercel env ls production` confirmou a existência de `DATABASE_URL`, mas, por segurança, não revelou seu valor ou parâmetros. O CLI consultado no projeto API não expôs nesta revisão o limite máximo de instâncias, concorrência efetiva da Function nem os limites de clientes/backend do Supavisor. Nada foi alterado na Vercel.

Com pool local 2, o orçamento teórico de clientes Prisma por réplicas API seria `2 × instâncias API simultâneas`, somado aos clientes de outros serviços/processos. Esse número não equivale a sessões efetivas no PostgreSQL quando há Supavisor transaction pooler: o pooler separa conexões cliente e servidores backend. `max_connections=60` menos 3 reservadas deixa 57 nominais, mas outros serviços, Auth, administração e carga atual precisam de reserva. Isso não autoriza alocar as 57 à API.

Antes de definir pool na Vercel, o responsável precisa consultar, sem compartilhar credenciais: (1) limite de instâncias e concorrência máxima da Function; (2) limite de conexões clientes do Supavisor; (3) tamanho do pool backend por database/role; (4) porta/modo e `connection_limit`/`pool_timeout` efetivos da `DATABASE_URL` Production; (5) conexões de outros consumidores e reserva operacional para Auth/administração. Até esses números serem conhecidos, `VERCEL_POOL_READY=NO`.

## Jornadas e classificações

| Jornada                                | Resultado | Motivo                                                                                                                                     |
| -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Login/admin                            | `PARTIAL` | JWT de administrador sintético, Auth real e guards ativos; logout/administração/seleção de organização não foram revalidados nesta rodada. |
| Clientes/processos                     | `PARTIAL` | Browser/API reais abriram lista de clientes, ficha, dashboard e processos. Não houve alteração real de cliente/processo nesta rodada.      |
| Contrato/recebível/pagamento/relatório | `BLOCKED` | A tela financeira não concluiu as leituras; nenhum pagamento ou relatório autenticado real foi iniciado pelo browser.                      |
| Despesa/aprovação/pagamento/caixa      | `BLOCKED` | A tela foi interrompida durante carregamento; nenhum estado ou dado financeiro foi alterado.                                               |
| Documentos                             | `NOT_RUN` | Cenário encerrado antes da tela.                                                                                                           |
| Tarefas/agenda                         | `NOT_RUN` | Cenário encerrado antes da tela.                                                                                                           |
| Cache de telemetria                    | `PASS`    | POSTs de telemetry não causaram refetch de clientes; evento de ficha corrigido e verificado no browser.                                    |

```text
NAVIGATION_STABLE: NO
POOL_2_VALIDATED: PARTIAL
REAL_BROWSER_FLOWS: BLOCKED
VERCEL_POOL_READY: NO
RELEASE_READY: NO
```

## Validações locais

| Verificação                                        | Resultado                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run format:check`                             | PASS; JSON de evidência gerado foi excluído do formatter e preservado sem reescrita. |
| `npm run lint`                                     | PASS                                                                                 |
| `npm run typecheck`                                | PASS                                                                                 |
| `npm test`                                         | PASS — 186 testes (139 API, 30 web, 17 shared).                                      |
| `npm run db:validate`                              | PASS; Prisma avisou que preview `metrics` está depreciado.                           |
| `npm run build`                                    | PASS — API, pacotes e Next.js.                                                       |
| `npm run test:e2e`                                 | PASS — 21 Playwright mockados, incluindo cliente em 360/1440 px.                     |
| `client-workspace.e2e.ts` direcionado após rebuild | PASS — 2 viewports; também incluído na suíte completa.                               |
| Navegação browser/API/PostgreSQL real              | FAIL/PARTIAL por fila; evidências e cortes acima.                                    |

## Arquivos desta missão

- `apps/web/features/app/legal-crm.tsx` — propagação do cliente selecionado para telemetria.
- `apps/web/e2e/client-workspace.e2e.ts` — asserção de `client-views` e do `clientId`.
- `tools/qa/validate-pool2-navigation.ts` — runner com pool local 2, telemetria, percurso solo completo, concorrência limitada, guard de fila e evidências redigidas.
- `tools/qa/README.md` — instruções e resultado atualizados.
- `.prettierignore` — exclusão dos JSON gerados em evidências, sem editar artefatos históricos.
- `PROJECT_CONTEXT.md` — estado e bloqueios atualizados.
- `docs/auditoria-2026-10-27/ESTABILIZACAO_NAVIGACAO_POOL2.md` — este relatório.
- `docs/auditoria-2026-10-27/evidencias-navegacao-pool2/qa-navigation-pool2-1793220589241-6d91c2.json` e `qa-navigation-pool2-1793220919634-6c9391.json`, logs correspondentes e artefatos das tentativas locais anteriores.

## Próximas ações para candidata a publicação

1. Reduzir roundtrips de membership/permissões e rate limit por página sem remover autorização nem rate limiting distribuído. Qualquer cache de membership precisa definir revogação e TTL antes da implementação.
2. Reduzir a fan-out da tela financeira/despesas ou oferecer uma leitura agrupada que preserve escopo por organização e permissões; manter Decimal e relatórios existentes.
3. Repetir o browser real com uma sessão até todos os módulos terminarem sem fila crescente ou chamadas pendentes. Só então repetir concorrência de duas identidades sintéticas distintas e, se houver margem, três.
4. Confirmar no Supabase/Vercel os limites pedidos na seção anterior e calcular orçamento total incluindo todos os consumidores e reserva.
5. Critérios objetivos: navegação sequencial completa sem P2024, sem chamadas pendentes, fila máxima ≤1; duas identidades concorrentes sem 5xx/429 inesperado ou duplicidade; fluxo financeiro completo validado por UI e banco; p95 aquecido por rota <2 s como meta; orçamento Vercel/Supavisor aprovado pelo responsável.

Até esses itens serem concluídos, manter a configuração de produção sem alterações e não liberar a versão como candidata de publicação.

## Ajustes de redução de fan-out e membership — 2026-10-28

Esta seção registra alterações locais posteriores ao ensaio pool 2. Ela não substitui nem reinterpreta as medições anteriores.

- `AuthenticationGuard` coalesce somente consultas `findMany` que ainda estão em andamento para o mesmo perfil e organização. Não retém o resultado depois da Promise concluir. O teste direcionado passou em 3/3 casos: requisições simultâneas com mesmo escopo compartilham a consulta; organizações distintas não compartilham; nova requisição após conclusão consulta o banco novamente.
- A tela Financeiro/Despesas usa `IntersectionObserver` com margem de 120 px para iniciar as leituras paginadas de recebíveis, pagamentos, correções e despesas conforme o usuário se aproxima de cada seção. A UI continua renderizando as seções; os dados são carregados sob demanda. A seção de recebíveis só é exibida/carregada com `receivables:view`.
- Mutações da tela agora recebem a lista explícita de conjuntos dependentes para atualizar. Isso evita recarregar listagens e resumos não relacionados. As alterações de negócio continuam usando a invalidação existente; telemetria não invalida o cache GET.
- O typecheck de `@livio/web` e o teste do guard passaram. A jornada mockada de pagamento passou uma vez com o lazy loading aplicado (1/1, antes da asserção adicional de rede). A repetição após adicionar a asserção foi encerrada pelo worker Node com `FATAL ERROR: ... heap out of memory` antes do início do teste. O host apresentava apenas 12 MiB de memória física livre; o teste deve ser repetido quando houver memória disponível. Portanto, essa nova asserção e a suíte de navegador atualizada estão `BLOCKED`, não PASS.
- Não foi feito novo ensaio HTTP autenticado nem navegação conectada ao PostgreSQL; não há p50/p95 posterior para comparar, nem prova de redução dos sete GETs ao longo de uma navegação completa. O benefício esperado é escalonar a carga por viewport e diminuir refetch após mutações, ainda sem medição integrada.
- A gravação do rate limit continua sendo um `upsert` atômico distribuído em PostgreSQL. Não foi substituída por memória local; o custo por requisição segue como gargalo observado. Uma implementação alternativa depende de serviço distribuído e limites/custo aprovados.
- Arquivos editados nesta etapa: `apps/api/src/auth/authentication.guard.ts`, `apps/api/src/auth/authentication.guard.test.ts`, `apps/web/features/shared/use-near-viewport.ts`, `apps/web/features/finance/finance-operations.tsx`, `apps/web/e2e/finance-payment.e2e.ts`, `PROJECT_CONTEXT.md` e este relatório.

Estado após este lote: mudança local implementada com validação parcial; `NAVIGATION_STABLE=NO`, `POOL_2_VALIDATED=PARTIAL`, `REAL_BROWSER_FLOWS=BLOCKED`, `VERCEL_POOL_READY=NO`, `RELEASE_READY=NO`. Próximo passo técnico é liberar recursos locais, executar a asserção Playwright atualizada e medir uma sessão real em pool 2 antes de testar concorrência ou jornadas de escrita.
