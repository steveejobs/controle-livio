# Sprint de qualidade, experiência real e estabilização

**Data:** 28/10/2026  
**Escopo:** validação local da aplicação web/API e testes sintéticos no PostgreSQL/Supabase atual.  
**Deploy, migrations e alterações cloud:** não executados.

## Resultado executivo

| Critério                   | Resultado   | Fundamentação                                                                                                                                                                                                                                 |
| -------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKEND_READY`            | **PARTIAL** | Financeiro e despesas passaram em HTTP autenticado. A meta de latência não foi atingida e P2024 voltou a ocorrer sob navegação rápida com pool local limitado a uma conexão.                                                                  |
| `FRONTEND_READY`           | **PARTIAL** | Navegador real autenticou perfis sintéticos, navegou 15 módulos e verificou portal e viewport de 360 px. Playwright passou em 21 testes, mas a maior parte do E2E usa mocks; não houve CRUD real ponta a ponta em todas as jornadas.          |
| `SECURITY_READY`           | **PARTIAL** | Isolamento via JWT/API e redaction foram verificados e alguns riscos corrigidos. RLS não foi exercida diretamente como role SQL `authenticated`; permanecem vulnerabilidades de dependências e o projeto de QA é ligado a Production/Preview. |
| `PRODUCTION_RELEASE_READY` | **NO**      | Desempenho abaixo do objetivo, risco de pool sob concorrência, validação real incompleta das jornadas, dependências vulneráveis e ausência de publicação/compatibilidade verificadas no commit atual.                                         |

O código desta sprint permanece local e não foi publicado. Os resultados positivos são específicos às operações e condições descritas abaixo; não equivalem a declarar o produto inteiro operacional.

## Estado e proteção do checkout

- Branch `main`, HEAD `919a5accc91bc96dbd87773411668d017f968e35`.
- O checkout já estava muito alterado. A contagem final foi 163 entradas em `git status` (97 modificadas/rastreáveis e 66 não rastreadas, incluindo esta documentação e evidências). Não houve reset, checkout destrutivo nem limpeza de arquivos QA.
- O Supabase usado foi `ioebcdpyrszokdyaoaqv`; Auth, Storage e PostgreSQL correspondem ao projeto identificado. Esse projeto também está associado a Vercel Production/Preview, portanto não é um TEST isolado.
- A migration `20261027150000_expense_workflow` já estava aplicada antes desta sprint. Nenhuma migration, alteração de schema, configuração cloud ou deploy foi executado nesta sprint.
- A última informação de Vercel disponível nesta sequência indicava deployments Web/API de 22/10/2026 no commit-base acima, com `gitDirty=1`. Não foi obtida evidência de que o código desta sprint esteja publicado nem de qual árvore suja foi incluída naquele deployment. A compatibilidade estrutural do código publicado com a migration aditiva foi revisada nas validações anteriores; a versão exata publicada continua sem comprovação suficiente.

## Resultados por jornada

| Jornada                | Resultado   | Evidência e limite da conclusão                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login e administração  | **PARTIAL** | Navegador real autenticou administrador sintético, visitou 15 módulos e encerrou a sessão. Administração foi visitada, mas não se executou CRUD administrativo completo. Evidência no JSON e screenshots do run `1793211266852-615ff3`.                                                                                                                                                                     |
| Clientes e processos   | **PARTIAL** | QA integrado/API anterior havia validado operações de cliente/processo; neste navegador houve navegação, sem repetir cadastro/edição/histórico pela interface real. E2E de interface passou com mocks. Não declarar fluxo de interface integralmente comprovado nesta sprint.                                                                                                                               |
| Contratos e financeiro | **PARTIAL** | Passaram overview autenticado, relatório de recebimentos, isolamento e concorrência de pagamentos com duas chaves idempotentes. Uma cobrança foi aceita e a concorrente rejeitada; uma alocação de `65.0000`, saldo `35.0000`, sem excesso. No browser houve navegação, não CRUD integral de contrato/recebível. Overview não atingiu p95 de 2 s.                                                           |
| Despesas               | **PARTIAL** | Os 9 checks específicos de despesa dentro do QA HTTP passaram: política/permissões, criação/edição, vencimento, comprovante privado/hash, aprovação, rejeição/reenvio, pagamento integral, duplicidade, transições, Decimal, relatórios e tenant. UI real percorreu a área, mas o ciclo completo não foi repetido com browser+API real. Pagamento parcial, reembolso e conciliação continuam indisponíveis. |
| Documentos             | **PARTIAL** | Upload do comprovante sintético privado, versão, SHA-256, host e expiração da URL assinada passaram no QA HTTP. Browser visitou documentos. DOCX/PDF, geração, versionamento integral, assinatura e revogação não foram todos reexecutados como jornada real conectada nesta sprint.                                                                                                                        |
| Tarefas e prazos       | **PARTIAL** | Browser visitou tarefas e agenda, e os E2E com mocks passaram. A navegação real mediu 24,4 s para tarefas. Atividade real dos lembretes não foi comprovada; o scheduler consta ativo e foi deixado intocado. Não afirmar que lembretes ou reagendamento estão ponta a ponta aprovados nesta sprint.                                                                                                         |
| Portal do cliente      | **PARTIAL** | Login real com JWT de cliente sintético e `clientId` vinculado passou; API/browser não expuseram navegação administrativa, não houve 5xx e testes de isolamento da API passaram. Mensagens/notificações completas não foram exercitadas no browser nesta sprint e RLS SQL como role `authenticated` não foi testada diretamente.                                                                            |

### Financeiro e despesas: QA HTTP autenticado

O artefato [qa-financial-http-1793210901033-f197d7.json](evidencias-sprint-qualidade/qa-financial-http-1793210901033-f197d7.json) registra **14/14 checks PASS**. O log de API correspondente está em [qa-financial-api-1793210901033-f197d7.log](evidencias-sprint-qualidade/qa-financial-api-1793210901033-f197d7.log).

- Overview: autenticação JWT, membership, permissão, rate limit, Prisma e resposta HTTP passaram; saldo sintético basal `100.0000 BRL`.
- Isolamento entre organizações: leitura com JWT de outro escritório recebeu 404 e não incluiu o cliente sintético.
- Pagamento concorrente: duas chaves distintas disputaram o mesmo saldo; respostas 201/400, um pagamento confirmado, uma alocação ativa, total alocado `65.0000` e saldo `35.0000`.
- Relatório pós-pagamento: HTTP 200, recebido `65.00`, saldo no overview `35.0000`.
- Despesas: política segura por padrão quando ausente, configuração protegida, aprovação independente, escritório com administrador único, valores `125.1250` e `20.1000`, pagamento integral, parcial/duplicado e transições proibidas rejeitados. Total pago no relatório `145.2250 BRL`.
- Comprovante sintético ficou em bucket privado; a versão e o hash corresponderam ao upload. URL assinada expirou em 300 s e usou o host do projeto esperado.
- Nenhum documento real foi usado. QA arquivou as duas organizações sintéticas e suspendeu/baniu contas sintéticas. Perfis, eventos imutáveis de auditoria, counters e comprovante privado foram preservados como evidência. O preflight do run registrou `existingDataModified=false`.

## Rate limit: causa e correção

O guard aplica limite por organização e chave de usuário/IP com hash, janela UTC de minuto fixo e upsert atômico do contador. O cabeçalho `x-ratelimit-remaining` reflete o contador da janela que atendeu aquela requisição. Ele pode voltar a um valor alto quando a janela muda; em concorrência, a ordem de conclusão HTTP não precisa coincidir com a ordem dos incrementos.

A falha original do harness vinha da asserção que exigia decremento estrito em toda resposta. Ela não modelava virada da janela nem reordenação de respostas. O teste agora confere janela estável, contador persistido e cabeçalho, e permite o reset legítimo. O teste unitário cobre rollover. No QA real o rate limit permaneceu ativo: o contador sintético aumentou de 1 para 3 em duas chamadas concorrentes, e o par de respostas reportou 297/298 restantes na mesma janela. Portanto, **a causa da falha dessa asserção estava no teste, não numa desativação do middleware**. A correção não enfraqueceu o limite.

## Desempenho e contenção de conexões

### Overview HTTP real

O run autenticado [qa-financial-http-1793211266852-615ff3.json](evidencias-sprint-qualidade/qa-financial-http-1793211266852-615ff3.json) contém 13 medições e instrumentação por estágio. O log está em [qa-financial-api-1793211266852-615ff3.log](evidencias-sprint-qualidade/qa-financial-api-1793211266852-615ff3.log).

| Medida                                 |    Amostras |      p50 |      p95 |   Máximo |
| -------------------------------------- | ----------: | -------: | -------: | -------: |
| HTTP aquecido, concorrência 1          |          10 | 2.517 ms | 2.672 ms | 2.672 ms |
| HTTP incluindo frio e concorrência 2   |          13 | 2.538 ms | 5.300 ms | 5.300 ms |
| Consulta Prisma (roundtrip do cliente) | 180 eventos |   164 ms |   337 ms |   368 ms |
| Tempo de resposta registrado pela API  |          13 | 2.531 ms | 5.291 ms | 5.291 ms |

A requisição fria foi 3.162 ms. As duas chamadas concorrentes levaram 4.435 e 5.300 ms. O alvo aquecido p95 inferior a 2 s **não foi alcançado**.

`Server-Timing` reportou p95 de 371 ms para claims de Auth, 1.674 ms para roundtrip de membership no Prisma, 1.826 ms para roundtrip do rate limit, aproximadamente 0 ms no guard de permissão e 1.805 ms no handler. Cada request teve mediana de 13 e máximo de 24 eventos Prisma. Os estágios de Prisma incluem aquisição do pool, rede e SQL; essa instrumentação não separa essas parcelas. Não é possível afirmar qual parcela individual explica toda a latência sem tracing do driver/pooler e medição no servidor PostgreSQL.

### Navegação de módulos no browser

O teste navegou sequencialmente e aguardou a API ficar ociosa. Os tempos são clique até a rede ficar ociosa, não renderização isolada nem p95 de endpoint. Mediana observada: **9.671 ms**; máximo: **26.473 ms**. Relatórios levou 26.473 ms e tarefas 24.400 ms. A sequência foi: Visão geral 887 ms; Clientes 6.898 ms; Processos 9.671 ms; CRM 11.131 ms; Cobrança 9.245 ms; Documentos 1.196 ms; Tarefas 24.400 ms; Agenda 6.575 ms; Notificações 14.194 ms; Contratos 10.290 ms; Recebíveis 1.464 ms; Relatórios 26.473 ms; Usuários/permissões 12.977 ms; Pipelines 6.762 ms; Atividades 14.730 ms. Isso indica trabalho pendente de profiling por tela/endpoint; a métrica não identifica sozinha o custo de renderização.

### P2024 reproduzido sob pool restrito

Uma passagem anterior do browser alternou rapidamente as telas com a API local configurada em `connection_limit=1` e `pool_timeout=10`. Houve P2024 real: `GET /documents/templates` respondeu 500 após cerca de 10,051 s; chamadas simultâneas de membership e rate-limit também esperaram pelo pool. A passagem final serializada não teve 5xx, mas **não demonstra que o problema de capacidade foi eliminado**. Não aumentamos pool nem timeout; é necessária medição de conexões/concorrência no pooler e no limite de instâncias antes de mudar esses valores.

## Browser, UX e acessibilidade

O artefato [qa-financial-web-1793211266852-615ff3.log](evidencias-sprint-qualidade/qa-financial-web-1793211266852-615ff3.log) registra login real no Supabase, frontend Next local e API Nest local, 15 módulos visitados, 53 requests da API, zero respostas 5xx e sessão de administrador encerrada. Quatro 401 de `GET /auth/me` ocorreram antes do login, na verificação inicial de sessão. A sessão de cliente usou JWT sintético e vínculo explícito, e não mostrou menu administrativo.

No viewport 360 px não houve overflow horizontal. O filtro de atividades tinha controles sobrepostos; os rótulos/controles foram organizados em grid responsivo e os cinco controles mediram 294 px. Evidências: [admin desktop](evidencias-sprint-qualidade/qa-browser-1793211266852-615ff3-administrator-desktop.png), [admin](evidencias-sprint-qualidade/qa-browser-1793211266852-615ff3-administrator.png) e [portal](evidencias-sprint-qualidade/qa-browser-1793211266852-615ff3-portal.png).

`npm run test:e2e` passou **21/21** testes em desktop/mobile. Esses testes de interface usam mocks e não substituem as jornadas reais com API/banco. A smoke real verificou navegação, autenticação, portal e layout, não cada formulário e transição da matriz. O login do cliente levou 17.277 ms. A medição de navegação e esses tempos justificam profiling antes de afirmar boa experiência diária.

## Segurança e integração

### Alterações defensivas desta sprint

- Redaction de URL, query/params, Authorization, cookies, tokens e chave de idempotência em logs; sanitização de token/URL de assinatura em erros. Os testes cobrem a remoção dos valores sensíveis.
- Instrumentação de etapas de request e de roundtrips Prisma somente com `QA_TIMINGS=true`; não registra SQL, parâmetros nem dados financeiros nos eventos adicionados.
- Teto do upload em memória reduzido de 100 MiB para 20 MiB, alinhado ao teto de negócio existente; teste do limite adicionado. O upload continua em memória, agora limitado.
- Correção apenas no teste de rate limit para janela/concorrência e correção da fixture QA para que cliente sintético receba somente permissões do próprio papel.
- Ajuste de layout mobile nos filtros de atividades.
- Ajuste de opções transacionais delimitadas no fluxo de despesas que anteriormente excedia o timeout interativo de 5 s; os testes do fluxo real passaram. Isso não resolve saturação geral de pool.

### Riscos que permanecem

- O projeto de teste compartilha o mesmo projeto Supabase ligado a Production/Preview. Escritas desta execução foram sintéticas e autorizadas, mas isso não é uma configuração segura para QA contínuo sem segregação e gates adicionais.
- O scheduler estava ativo. Foi mantido intacto; a execução não criou lembretes vencidos nem enviou e-mail, push, webhook ou cobrança. O preflight encontrou zero subscriptions de push e nenhuma credencial externa no processo, mas a atividade futura do job não está desativada por este teste.
- O preflight reportou RLS habilitada/protegida em 13/13 tabelas. **Não** executamos queries como role PostgreSQL `authenticated`; os resultados de isolamento vêm da API/JWT e filtros de organização, não constituem validação direta de RLS.
- URLs assinadas continuam sendo capacidades bearer de curta duração (300 s). Logs/erros foram redigidos, mas compartilhar uma URL válida ainda permite acesso até expirar.
- O buffer de upload permanece em memória, limitado a 20 MiB; não é streaming.
- A auditoria de dependências, após atualizações pontuais, ainda reportava 5 vulnerabilidades high em dependências de produção (famílias Nest/Express-Multer e Prisma/deepmerge-ts, cujas correções indicadas envolvem major upgrades) e findings adicionais em dev, incluindo 2 critical ligados a Vitest/tinypool. Nenhum upgrade major foi feito.
- O backup pré-migration de `public` não teve restauração testada e não inclui Auth/Storage; este risco residual continua relevante para recuperação, embora não tenha sido alterado nesta sprint.

## Regressão e verificações executadas

| Verificação                                                          | Resultado                                                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Testes unitários (`npm test`)                                        | PASS — 183 testes: API 137, Web 29, Shared 17                                     |
| Playwright (`npm run test:e2e`)                                      | PASS — 21/21, UI com mocks                                                        |
| QA integrado HTTP autenticado financeiro/despesas                    | PASS — 14/14 checks                                                               |
| Smoke browser conectado a Auth/JWT, API local e PostgreSQL existente | PASS para escopo restrito descrito acima; 0 respostas 5xx na passagem serializada |
| `npm run lint`                                                       | PASS                                                                              |
| `npm run format:check`                                               | PASS                                                                              |
| `npm run typecheck`                                                  | PASS                                                                              |
| `npm run db:validate`                                                | PASS — Prisma schema válido; sem migration nesta sprint                           |
| `npm run build`                                                      | PASS — API e Web                                                                  |
| Typecheck/lint do harness QA e E2E direcionado                       | PASS                                                                              |
| `npm audit`                                                          | NÃO PASS — vulnerabilidades remanescentes listadas acima                          |
| RLS como role PostgreSQL `authenticated`                             | NOT RUN                                                                           |
| Deploy/compatibilidade da árvore local com deployment efetivo        | NOT RUN                                                                           |

## Arquivos e artefatos

Principais arquivos de implementação/teste tocados nesta sprint (sem pretender atribuir a esta sprint o conjunto inteiro do working tree que já estava sujo):

- API: `apps/api/src/common/request-timing.ts`, `request-timing.interceptor.ts`, `request-timing.interceptor.test.ts`, `request-log-redaction.ts`, `request-log-redaction.test.ts`, `request-rate-limit.guard.window.test.ts`, `request-with-actor.ts`, `app.module.ts`, `auth/authentication.guard.ts`, `auth/permission.guard.ts`, `common/request-rate-limit.guard.ts`, `common/api-exception.filter.ts` e teste, `prisma/prisma.service.ts`, `documents/documents.controller.ts`, teste de limite de upload, `finance/finance.service.ts` e teste.
- Web/QA: `apps/web/theme/operations.css`, `apps/web/e2e/all-modules.e2e.ts`, `tools/qa/validate-financial-http.ts`.
- Dependências: `apps/api/package.json`, `packages/shared/package.json`, `package.json` e `package-lock.json` (somente atualizações pontuais descritas; sem upgrade geral).
- Documentação: este relatório e `PROJECT_CONTEXT.md`.
- Evidências duráveis: `docs/auditoria-2026-10-27/evidencias-sprint-qualidade/`, incluindo JSON de resultado, logs redigidos e screenshots listados acima.

## Plano para a versão candidata

| Classificação       | Prioridade e ação                                                                                                                                                                      | Critério de aceite objetivo                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MANTER**          | Pagamentos atômicos, Decimal, idempotência, isolamento por organização, rate limit ativo e ciclo de despesa de pagamento integral/aprovação.                                           | Repetir os checks HTTP sintéticos: uma alocação por saldo disputado, soma exata, nenhum cross-tenant, relatório igual ao ledger.                                                 |
| **CORRIGIR — P0**   | Profile do overview e roundtrips de membership/rate limiter; descobrir a origem do P2024 sob pool 1 e concorrência rápida. Não aumentar pool antes de dimensionar pooler e instâncias. | No ambiente e limite de conexões que serão publicados, 30+ requests aquecidos, concorrência 1 e 2, p95 <2 s ou causa externa isolada com SLO aprovado; nenhum P2024.             |
| **CORRIGIR — P0**   | Resolver findings high de produção e avaliar correções de majors com testes de compatibilidade; planejar atualização de Vitest/tinypool para findings critical de dev.                 | `npm audit --omit=dev` sem high/critical; audit de dev sem critical ou exceção formal com pacote/mitigação e prazo.                                                              |
| **CORRIGIR — P0**   | Confirmar segurança operacional antes da release: identidade/ambiente de QA, scheduler, integrações e teste direto de RLS.                                                             | Execução de leitura/negativa como role SQL `authenticated` e JWTs de papéis; artefato comprova isolamento; nenhum efeito externo; scheduler e credenciais têm política definida. |
| **COMPLETAR — P1**  | Browser/API real de clientes/processos, contratos/recebíveis, despesas, documentos, tarefas, agenda e portal.                                                                          | Fluxos CRUD e transições reais para cada papel passam com artefato Playwright/API, sem mock no caminho testado, incluindo estados vazios/erros e organização cruzada.            |
| **COMPLETAR — P1**  | Reexecutar matriz de documentos (DOCX/PDF, versões, assinatura, revogação, visibilidade) e tarefas/lembretes, com scheduler controlado.                                                | Evidência de formato/hash/download/expiração e workflow sintético; lembrete gerado em mecanismo de teste sem destinatário real.                                                  |
| **REDESENHAR — P1** | Investigar as telas de tarefas e relatórios e o atraso de login/navegação; separar tempo HTTP, renderização, consultas e assets por tela.                                              | Perfil com breakdown reproduzível, sem bloqueio da UI; navegação nas telas principais abaixo do orçamento acordado e estado loading/erro utilizável.                             |
| **DECIDIR — P0**    | Definir política para QA em projeto ligado a Production/Preview, disponibilidade do scheduler e destino de notificações/integrações externas.                                          | Aprovação explícita do proprietário para ambiente e controles; testes não podem criar efeito externo nem tocar registros não sintéticos.                                         |
| **DECIDIR — P1**    | Definir SLO de overview e envelope máximo de conexões considerando pooler e escalabilidade da Vercel.                                                                                  | Limites de conexões e concorrência documentados e aprovados antes de alteração de pool/timeout.                                                                                  |
| **CRIAR**           | Nenhuma funcionalidade de produto nova foi justificada ou criada nesta sprint.                                                                                                         | Reavaliar apenas após decidir lacunas de produto; não criar módulo para cobrir os problemas de performance/validação.                                                            |

## Conclusão

Há comprovação real de autenticação HTTP, pagamentos concorrentes consistentes, relatórios, isolamento por API, permissões e operações centrais de despesas. O frontend também concluiu smoke real com os papéis sintéticos e layout mobile corrigido. Ainda assim, overview aquecido excede a meta, pool restrito reproduz P2024, telas têm esperas altas, segurança de dependências mantém findings e as jornadas completas de UI não foram todas exercitadas sem mocks. Por isso, o sistema **não está pronto para publicação comercial**. A próxima etapa deve priorizar capacidade/performance e segurança, depois fechar a matriz browser/API real em ambiente operacionalmente seguro; nenhuma dessas ações foi executada automaticamente.
