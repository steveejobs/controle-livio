# Estabilidade, concorrência e capacidade

**Data:** 2026-10-28  
**Resultado:** `PARTIAL`  
**Escopo:** diagnóstico de pool, medição controlada, correção pontual no cache da web e regressão local. Sem migrations, deploy ou mudanças de configuração cloud.

## Estado inicial e segurança

- Checkout em `main`, HEAD `919a5accc91bc96dbd87773411668d017f968e35`. A árvore já estava extensamente modificada e continha arquivos não rastreados antes deste trabalho. As alterações preexistentes foram preservadas.
- O destino efetivo lido foi Supabase `ioebcdpyrszokdyaoaqv`, conectado a Vercel Production e Preview. Não é um ambiente isolado de testes. A API local usou PgBouncer Supabase na porta 6543 com `connection_limit=1`; `pool_timeout` estava ausente e, no Prisma 6, vale o default de 10 segundos. Isso descreve a configuração local observada, não confirma a configuração da Vercel.
- A inspeção PostgreSQL encontrou versão 17.11, `max_connections=60`, 3 conexões reservadas, 8 sessões visíveis e 1 ativa antes dos probes. No lote do pool 3 foram observadas 9 sessões. A credencial disponível não podia consultar `SHOW POOLS`; limite de clientes/servidores do PgBouncer e margem por tenant não foram comprovados.
- Preflight do run sintético registrou signup público desativado, nenhuma credencial de entrega externa detectada, zero inscrições push, bucket privado e scheduler ativo. O scheduler não foi alterado nem acionado pelo QA. Não foram enviados e-mails, push, webhooks ou cobranças. As 13 tabelas verificadas estavam protegidas por RLS; esta execução não conectou como role PostgreSQL `authenticated`, portanto não é uma prova direta dessa role.
- A execução de browser usou apenas identidades e organizações sintéticas. O relatório registrou `existingDataModified=false`. Ao encerrar, uma organização sintética foi arquivada, três memberships/usuários foram suspensos e três identidades Auth foram banidas; perfis e registros de auditoria/rate limit QA foram retidos como evidência. Não houve migration, deploy nem alteração de configuração cloud.

## Causa e diagnóstico

### O que foi confirmado

1. **O pool de uma conexão é o gargalo imediato sob navegação concorrente.** O `PrismaService` é singleton por processo Nest, então não encontrei criação de PrismaClient por requisição. Porém, no processo local cada chamada concorrente disputa a única conexão. O pool do Prisma enfileira consultas; com `pool_timeout=10`, a fila pode terminar em `P2024`.
2. **A navegação real produziu concorrência sustentada.** Em 45 segundos de navegação rápida autenticada, o Prisma registrou 616 amostras de pool, máximo de 13 consultas esperando e uma conexão ocupada/aberta. O harness marcou falha porque quatro chamadas locais continuavam pendentes. Isso confirma backlog e instabilidade, mesmo sem erro 5xx entre as chamadas que concluíram.
3. **Cada requisição carrega trabalho recorrente de autenticação/autorização e rate limit.** Foram vistos 23 SELECTs de membership/organização/usuário/papéis/permissões e 23 upserts de `api_rate_limits`, além de eventos de auditoria e consultas dos módulos. As duas formas recorrentes tiveram p50 de 353 ms e 345 ms, respectivamente, na medição do evento Prisma. O cliente Prisma enfileira tudo no mesmo pool.
4. **A navegação causava invalidação desnecessária do cache de dados.** Os POSTs de telemetria `module-views` e `client-views` eram tratados como qualquer mutação e invalidavam leituras GET em andamento/cacheadas. Isso criava recargas evitáveis durante a troca de módulos. Foi corrigido para esses dois endpoints de telemetria somente; gravações de negócio continuam invalidando o cache.

### O que não foi demonstrado

- O pool não mostrou `P2024` no conjunto capturado desta execução; o teste terminou com chamadas pendentes antes de obter o resultado delas. A reprodução anterior de `P2024` com pool 1 permanece registrada na auditoria de sprint. Portanto, esta execução **não comprova** ausência de P2024.
- Não há evidência de transação de negócio longa como causa primária. O log capturou 73 `BEGIN`, 72 `COMMIT` e 72 eventos intermediários, com eventos individuais em torno de 171–172 ms. Isso mede roundtrips do cliente Prisma e não a duração completa de cada transação nem o tempo em que uma conexão ficou retida. A instrumentação da próxima rodada precisa correlacionar começo/fim por requisição/transação.
- A duração de evento Prisma inclui o caminho cliente/banco; não separa CPU SQL de rede/PgBouncer. Os gauges/histogramas separam espera interna do pool, mas a divisão de Auth, guards, rate limit, handler, transação e serialização por rota não pôde ser consolidada porque o smoke real terminou com chamadas pendentes.
- A tela/módulo que gerou cada request concorrente não foi preservada no artefato do smoke interrompido. As formas SQL identificam consultas de dashboard, clientes, processos, recebíveis/relatórios, tarefas, calendário, notificações, documentos, auditoria e telemetria, mas não permitem atribuir um pico específico a uma tela. Auth/membership e rate limit aparecem transversalmente em 23 chamadas.
- `pg_stat_activity` não prova capacidade do PgBouncer. Máximo de instâncias serverless, pool por instância e configuração publicada da Vercel não foram acessíveis/verificados nesta etapa.

## Comparação controlada do pool

Probe somente leitura no banco, um `PrismaClient` por vez, três lotes de três consultas concorrentes `SELECT pg_sleep(80ms) IS NULL` por pool. São 9 amostras/configuração; p95 usa a amostra mais lenta, logo é indicativo, não um percentil de produção robusto. O teste exige margem PostgreSQL observável de dez conexões e não consulta tabelas de negócio.

| Pool |      p50 | p95 / máximo | Espera acumulada do histograma | Pico de espera / ocupadas / abertas | Falhas |
| ---: | -------: | -----------: | -----------------------------: | ----------------------------------: | -----: |
|    1 | 1.843 ms |     2.773 ms |                       8.286 ms |                           2 / 1 / 1 |      0 |
|    2 |   942 ms |     2.165 ms |                       2.815 ms |                           2 / 2 / 2 |      0 |
|    3 |   925 ms |     2.172 ms |                         1,8 ms |                           2 / 3 / 3 |      0 |

O pool 2 reduziu a espera frente ao pool 1; pool 3 reduziu ainda mais a fila, mas não melhorou o p95 desta amostra. Mesmo com pool 3, consultas de 80 ms tiveram p95 acima de 2 s. Isso aponta custo relevante fora da fila Prisma (rede, PgBouncer e roundtrip), mas não identifica qual deles é dominante.

**Configuração recomendada:** não alterar a Vercel. Para um único processo local de API, `connection_limit=2` é candidato a próxima validação controlada, não um valor aprovado para produção. Pool 3 não mostrou ganho de p95 sobre 2. Antes de elevar o pool em serverless, medir `máximo de instâncias × pool por instância`, outras aplicações do banco, `SHOW POOLS`/limites no PgBouncer e margem do projeto. Não aumentar `pool_timeout` para mascarar fila.

## Navegação HTTP real

O browser local autenticou identidades sintéticas e navegou rapidamente por módulos, usando a API local e banco compartilhado, pool 1, rate limit ativo e `pool_timeout=10`.

- 301 eventos Prisma concluídos: p50 173 ms, p95 356 ms, máximo 714 ms. Esses números não incluem consultas que ainda estavam em fila quando o processo foi encerrado.
- Fila Prisma máxima: 13; conexões busy/open máximas: 1/1.
- 16 respostas HTTP terminaram: 3×200, 2×401 durante a sondagem inicial pré-login de `/auth/me`, 11×201 em rotas POST sintéticas; o artefato interrompido não preservou o mapeamento de cada status à rota. Máximo observado de resposta: 31.128 ms. Quatro outras chamadas ainda estavam ativas após 45 s; não há p50/p95 válido do conjunto completo.
- Nenhum 5xx foi observado entre as 16 respostas concluídas. O run marcou `FAIL` pelo backlog e parou como exige o critério de segurança. O contador de P2024 para as chamadas pendentes é desconhecido.
- O rate limit permaneceu ativo. A interface não foi exercitada novamente contra o banco depois desta saturação.

## Correções e regressão

- O cache GET da web mantém deduplicação e cancelamento existentes. Os POSTs `module-views` e `client-views`, por serem telemetria sem mudança de estado de negócio, agora preservam leituras/cache; demais operações de escrita mantêm invalidação normal.
- Adicionada instrumentação QA de formas de query (operação, tabelas e hash estável sem SQL/parâmetros), gauges de pool, histograma de espera e configuração sanitizada. Só roda com `QA_TIMINGS=true`. O Prisma `metrics` é preview/depreciado no Prisma 6 e requer substituição por instrumentação estável antes da migração ao Prisma 7.
- Harness de QA passa a selecionar pool local 1–3, executar navegação rápida, capturar chamadas pendentes e métricas finais. O benchmark SQL exige confirmação explícita e margem observável. `playwright.config.ts` aceita pasta de saída própria para não sobrescrever resultados anteriores.

Validações locais:

- `npm test`: **186/186** (139 API, 30 web, 17 shared).
- `npm run test:e2e`: **21/21** com API mockada, inclusive 360 px; resultado em `evidencias-capacidade-concorrencia/playwright-regressao-20261028/`.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm run db:validate`: PASS, com aviso de preview `metrics` depreciado.
- `npm run build`: PASS (API, UI e Next).
- Harness `tools/qa/validate-financial-http.ts`: TypeScript estrito, ESLint e Prettier PASS.
- Prettier nos arquivos de código QA alterados: PASS. `npm run format:check` global: FAIL por seis JSON de evidência gerados, incluindo saídas anteriores; não foram reformatados para preservar artefatos de execução.

Os testes unitários comprovam deduplicação de cache e parsing seguro da forma das consultas. Não substituem teste concorrente HTTP, isolamento com usuário real em cada jornada nem validação de pagamentos no banco.

## Jornadas e prontidão

| Jornada pedida                               | Estado nesta execução | Evidência / motivo                                                                                                         |
| -------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Cliente → processo → responsável → status    | BLOCKED               | Não concluída no browser real; o ensaio de navegação parou por backlog.                                                    |
| Contrato → recebível → pagamento → relatório | BLOCKED               | Nenhuma gravação financeira real iniciada nesta rodada; não repetir no alvo compartilhado enquanto saturado.               |
| Despesa → aprovação → pagamento → caixa      | BLOCKED               | Nenhuma gravação de despesa real iniciada nesta rodada; não extrapolar testes HTTP anteriores para o browser desta missão. |
| Navegação rápida autenticada                 | FAIL                  | 4 chamadas pendentes, pico de espera 13; chamadas concluídas não tiveram 5xx.                                              |
| Playwright de interface mockada              | PASS                  | 21/21, sem backend real.                                                                                                   |

- `BACKEND_READY: PARTIAL` — endpoints e testes locais passam, mas sob concorrência real surgiu backlog e a capacidade de produção não foi medida.
- `FRONTEND_READY: PARTIAL` — 21 casos UI mockados passam e a invalidação redundante foi corrigida; persistência/refetch nas três jornadas reais não foi comprovada.
- `SECURITY_READY: PARTIAL` — permissões reais foram usadas no smoke sintético, mas as jornadas foram interrompidas; RLS direta como role PostgreSQL authenticated não foi validada.
- `PRODUCTION_RELEASE_READY: NO` — mudança não publicada, Vercel não verificada nesta rodada, carga real falhou e pooler/serverless capacity permanece desconhecida.

## Próxima prioridade para publicação

1. Confirmar no Supabase Dashboard a capacidade e estatísticas do pooler, e na Vercel o máximo de instâncias e URL/pool efetivos; calcular o orçamento agregado de conexões antes de mudar qualquer configuração.
2. Em uma janela autorizada, testar API local com pool 2 e baixa concorrência (1 e 2), com 10+ amostras aquecidas, registro de `Server-Timing` por rota, fila Prisma e todas as respostas. Parar imediatamente ao primeiro backlog crescente/P2024.
3. Corrigir roundtrips recorrentes de membership/rate limit apenas se medições por rota confirmarem que dominam; preservar escopo multi-tenant, enforcement de permissões e rate limit.
4. Após uma execução estável e isolada de outras cargas, executar as três jornadas completas em usuários/organizações QA autorizados e verificar persistência no PostgreSQL e reflexo na UI.
5. Substituir Prisma Metrics preview antes de atualizar para Prisma 7. A publicação continua dependendo de revisão da versão Vercel/schema e autorização de deploy separada.

## Arquivos alterados nesta missão

- `apps/api/src/prisma/prisma.service.ts`
- `apps/api/src/prisma/pool-diagnostics.ts` e `apps/api/src/prisma/pool-diagnostics.test.ts`
- `apps/web/lib/api.ts` e `apps/web/lib/api.test.ts`
- `packages/db/prisma/schema.prisma` (somente habilitação de métricas Prisma; sem alteração PostgreSQL)
- `playwright.config.ts`
- `tools/qa/benchmark-prisma-pool.mjs`
- `tools/qa/inspect-prisma-pool.mjs`
- `tools/qa/validate-financial-http.ts`
- `tools/qa/README.md`
- `PROJECT_CONTEXT.md`
- Este relatório e artefatos em `docs/auditoria-2026-10-27/evidencias-capacidade-concorrencia/`.

O checkout já continha ampla alteração não relacionada a esta missão. A lista acima descreve os arquivos intencionalmente tocados nesta etapa; nenhum arquivo histórico foi restaurado ou descartado.

## Artefatos

- Pool probe corrigido: `evidencias-capacidade-concorrencia/qa-prisma-pool-1793213770986-85f516.json`.
- Tentativa inicial inválida (`pg_sleep` retorna `void`, rejeitado pelo decoder Prisma P2010): `evidencias-capacidade-concorrencia/qa-prisma-pool-1793213732368-764ffb.json`; nenhuma escrita ocorreu.
- Navegação real interrompida: `evidencias-capacidade-concorrencia/qa-financial-http-1793214069720-352608.json`, logs API/web correspondentes.
- Playwright mockado: `evidencias-capacidade-concorrencia/playwright-regressao-20261028/`.
