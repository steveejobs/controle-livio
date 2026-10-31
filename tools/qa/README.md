# Execução de QA integrado

## Memória local e testes sequenciais no Windows

`configurar-memoria-windows.ps1` usa CIM e APIs locais do PowerShell para exibir RAM, commit, pagefile, disco e processos. `-Acao Configurar` só propõe pagefile C: de 8–14 GiB quando há pressão de commit, espaço suficiente e nenhum limite maior a preservar; salva os valores originais em `%LOCALAPPDATA%\LivioQA\Pagefile`. Se precisar de elevação, solicita UAC normal e nunca reinicia o computador. `-Acao Testar` executa os testes Vitest com um worker, lint e TypeScript em sequência; build/E2E só iniciam com margem de RAM maior. Os logs transitórios ficam em `%TEMP%` e são removidos ao terminar.

```powershell
powershell -NoProfile -File tools/qa/configurar-memoria-windows.ps1 -Acao Diagnostico
powershell -NoProfile -File tools/qa/configurar-memoria-windows.ps1 -Acao Configurar
powershell -NoProfile -File tools/qa/configurar-memoria-windows.ps1 -Acao Testar
```

Os scripts Vitest da API e web limitam workers e paralelismo de arquivos. O Playwright já usa um worker e execução sequencial. O teste direto de `use-api-data` ainda não possui harness unitário no projeto; o runner cobre o cliente HTTP/cache relacionado e tenta o E2E financeiro quando a memória permite.

`verify-workflows.ts` grava dados em Auth, PostgreSQL e Storage. Use primeiro uma stack Supabase local descartável. A fase `--preflight` é somente leitura: identifica os destinos efetivos, consulta buckets e RLS, verifica o scheduler e informa se a escrita está autorizada.

## Preflight somente leitura

Prepare `.env.test.local` a partir dos templates de `docs/infra/`. Confirme que a ref veio do Supabase Dashboard e que `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, URLs/chaves anônimas e `DATABASE_URL`/`DIRECT_URL` apontam para a mesma ref. Não carregue o `.env` atual, que usa um projeto conectado a Production/Preview. Nenhuma senha ou chave é impressa.

```powershell
node --env-file=.env.test.local --import tsx tools/qa/verify-workflows.ts --preflight
```

O preflight consulta `auth/v1/settings`, abre uma conexão PostgreSQL, lista buckets com acesso administrativo somente para leitura e verifica RLS forçada nas tabelas cobertas. Também consulta `cron.job`, suas execuções recentes e `scheduled_job_state`. Não usa service role para simular permissões de usuários.

## Critérios para qualquer escrita remota

Variáveis `SUPABASE_ENVIRONMENT`, `QA_PROJECT_REF` e `CONFIRM_SUPABASE_PROJECT_REF` não comprovam isolamento. Antes de aprovar um alvo remoto, confira independentemente no Supabase Dashboard o nome e a ref do projeto e compare a ref usada por Production na Vercel. Auth, PostgreSQL e Storage do alvo devem pertencer ao mesmo projeto TEST/DEV, sem conexão de produção.

O script exige API local, `SUPABASE_ENVIRONMENT=test`, comparação com ref de produção verificada e uma allowlist de project refs versionada no próprio `verify-workflows.ts`. A allowlist está vazia. Adicione um projeto somente depois da confirmação externa de separação e registre a evidência nesta documentação. A ref `ioebcdpyrszokdyaoaqv` permanece bloqueada: `docs/ENVIRONMENTS.md` registra que ela está conectada aos ambientes Production e Preview da Vercel.

Escritas também exigem `QA_EXTERNAL_DELIVERY_DISABLED=true` e ausência de credenciais SMTP/mail, VAPID, CRON, cobrança, mensagens ou webhooks. O Dashboard Auth e os schedulers precisam ser conferidos; a flag, sozinha, não comprova que a configuração cloud está isolada. Service-role fica somente no processo server-side/QA e nunca pode estar em `NEXT_PUBLIC_*`.

Depois da aprovação independente do alvo, execute:

```powershell
npm run build:api
$env:QA_ALLOW_WRITES = 'true'
node --env-file=.env.test.local --import tsx tools/qa/verify-workflows.ts --local-api
```

O trecho de escrita só será aceito depois de a ref ser revisada e incluída na allowlist; a variável `QA_ALLOW_WRITES` não a substitui. Não defina `SUPABASE_LOCAL=true` para um destino remoto. O teste cria duas organizações com prefixo aleatório, contas sintéticas e registros que apontam somente para essas organizações. As verificações de autorização usam tokens de administrador, advogado, financeiro, secretaria e cliente, conforme o caso. Service role fica restrita a provisionamento/encerramento e consulta de metadados do Storage.

## Resultado e limpeza

Cada jornada registra `PASS`, `FAIL`, `PARTIAL`, `BLOCKED` ou `NOT_RUN`, etapa, evidência e erro redigido. O artefato `test-results/qa-workflows-*.json` não inclui IDs de organizações ou tokens.

Ao terminar, o script suspende memberships, arquiva somente as organizações criadas pelo run e bane as identidades sintéticas. Ele encerra a API local e mantém histórico e objetos sintéticos do Storage como evidência; não apaga dados. Confira o campo `cleanup` no relatório. Se a finalização falhar, o relatório registra o erro e a execução termina com falha.

O fluxo de despesas está implementado no código local, mas depende da migration `20261027150000_expense_workflow`, que ainda não foi aplicada. Não execute o QA de despesas antes da aprovação e aplicação da migration em um destino explicitamente autorizado. A recorrência do calendário não expande ocorrências, e o QA não confirma entrega SMTP, push em dispositivo ou restauração de backup.

## Validação financeira HTTP e ciclo de despesas — 2026-10-27

`validate-financial-http.ts` cria somente organizações, contas, clientes e lançamentos sintéticos identificados pelo `runId`. O dono autorizou uma execução no projeto atual para dados sintéticos. O destino Auth/PostgreSQL/Storage foi confirmado como o mesmo projeto, mas ele também está conectado aos ambientes Vercel Production e Preview; portanto, isso não representa um ambiente isolado. O teste usa service-role apenas para provisionar e encerrar contas sintéticas; requisições da API usam JWTs de sessão, com guard de permissões e rate limit ativos.

Na execução registrada em `test-results/qa-financial-http-1793151156330-be7cdb.json`, o overview HTTP passou sem P2024 e o isolamento entre organizações retornou 404. Dez leituras aquecidas apresentaram p50 de 2.589 ms e p95/máximo de 2.755 ms; duas concorrentes levaram 4.280 e 5.130 ms. A disputa PostgreSQL de pagamentos com chaves diferentes produziu uma confirmação e uma rejeição, uma alocação de 65.0000, saldo restante de 35.0000 e nenhuma duplicação. O script manteve o rate limit ativo e arquivou/suspendeu apenas as duas organizações e identidades criadas pelo próprio run; perfis, auditoria e contador sintético ficaram retidos como evidência.

As rotas de despesas permanecem bloqueadas para execução integrada enquanto a migration estiver pendente. Não aplique migrations nem reaproveite os modos de escrita deste teste sem nova autorização explícita. O relatório `docs/auditoria-2026-10-27/IMPLEMENTACAO_FINANCEIRO_E_DESPESAS.md` registra escopo, status e limitações.

## Execução no banco atual — 2026-10-27

O proprietário autorizou uma rodada sintética no projeto atual. O preflight confirmou que Auth, PostgreSQL e Storage são do mesmo projeto, mas a ref também está associada a Vercel Production e Preview; portanto, esta rodada não comprova isolamento TEST/DEV. A autorização foi limitada aos tenants e identidades `qa-*` criados pelos próprios runs. O modo de escrita compartilhado continua desabilitado por padrão e não deve ser reutilizado sem autorização específica e novo inventário.

Resultado, jornadas e riscos estão em `docs/auditoria-2026-10-27/EXECUCAO_QA_BANCO_ATUAL.md`. O run final passou em clientes/processos, portal e tarefas/agenda; despesas e documentos ficaram parciais; financeiro falhou no overview por Prisma `P2024` (pool com uma conexão). O verificador agora mede o TTL por `iat`/`exp` e separa os checks financeiros dos documentais.

O finalizador arquivou os tenants, suspendeu memberships e baniu as contas. A remoção física foi tentada somente para cinco `runId`s fixos, mas uma trigger imutável rejeitou a transação inteira. Não desabilite triggers nem apague linhas manualmente. `cleanup-workflows.ts` agora é somente leitura: confirma retenção, estados de encerramento e contagens; `--apply` é recusado. Permanecem artefatos sintéticos porque documentos/versões, pagamentos e históricos têm retenção/relações protegidas. O inventário antes/depois confirmou que as contagens da organização não classificada não mudaram.

## Benchmark P0.1 do overview financeiro

`benchmark-financial-overview-optimized.mjs` é a revisão somente leitura do benchmark. Ele descobre até 20 organizações pelo prefixo sintético do run, seleciona um cliente com recebíveis e valida que `SUPABASE_PROJECT_REF`, a origem Auth e o usuário PostgreSQL identificam a mesma ref. O alvo precisa manter `connection_limit=1` e `pgbouncer=true`. O script não aceita IDs arbitrários, não usa service-role e não escreve.

A execução mede uma primeira leitura depois de desconectar o cliente Prisma (conexão/pool frio), dez leituras sequenciais aquecidas e somente duas chamadas concorrentes. Registra latência p50/p95/máxima, erros, duração Prisma de cada statement sem parâmetros, tabelas/assinaturas, tempo até o callback da transação começar, callback e serialização local com `JSON.stringify`. O intervalo até o callback combina fila do pool e aquisição/abertura da conexão; este harness não separa essas parcelas. A duração de evento Prisma inclui o caminho cliente-banco, não apenas CPU SQL.

Este teste continua medindo o serviço, não a rota HTTP: não chama Auth, guards, rate limit, serialização Nest nem RLS. O resultado geral fica `PARTIAL` enquanto não houver identidade QA ativa e autorizada para HTTP e gravação de rate limit restrita a dados sintéticos. O instrumento não reativa memberships ou usuários.

```powershell
$env:QA_RUN_PREFIX = 'qa-workflows-<runId>-'
$env:QA_OVERVIEW_WARM_SAMPLES = '10'
$env:QA_BENCHMARK_OUTPUT = 'test-results/financial-overview-optimized.json'
node --env-file=.env tools/qa/benchmark-financial-overview-optimized.mjs
```

Use somente o prefixo sintético de um run conhecido. O JSON não inclui IDs de organização/cliente, tokens, SQL ou dados de clientes; nele ficam status, contagens financeiras sintéticas e metadados de conexão sem credenciais.

## Benchmark somente leitura do overview financeiro

`benchmark-financial-overview.mjs` mede `/clients/:id/overview` diretamente no serviço, sem inicializar a API HTTP. Exige os IDs de uma organização e cliente sintéticos de um run `qa-workflows-*`, confirma o slug e o vínculo, exige `connection_limit=1` e `pgbouncer=true`, e limita a concorrência a três. Não usa Auth, service-role nem grava dados. O teste de isolamento usa um tenant irmão do mesmo run; o caso vazio usa um cliente QA sem recebíveis nem pagamentos. O resultado é criado com exclusividade em `test-results/` e não deve ser apontado para clientes ou organizações fora de um run sintético.

```powershell
$env:QA_ORGANIZATION_ID = '<UUID da organização QA>'
$env:QA_CLIENT_ID = '<UUID do cliente QA vinculado>'
$env:QA_RUN_PREFIX = 'qa-workflows-<runId>-'
$env:QA_BENCHMARK_OUTPUT = 'test-results/financial-overview-benchmark.json'
$env:QA_BENCHMARK_CONCURRENCY = '2'
$env:QA_BENCHMARK_ITERATIONS = '2'
node --env-file=.env tools/qa/benchmark-financial-overview.mjs
```

O harness não valida JWT, RLS nem o guard Nest; usa um ator sintético com permissões de leitura para medir o serviço e deve ser complementado pelos testes unitários de escopo. As durações e a contagem SQL registradas não incluem as consultas de validação do fixture.

## Diagnóstico de pool e navegação rápida — 2026-10-28

`inspect-prisma-pool.mjs` faz apenas leituras de identidade/configuração: verifica a ref do Supabase e o host efetivo do banco, consulta `max_connections`, conexões visíveis e métricas Prisma; não lê tabelas de negócio nem grava. O benchmark `benchmark-prisma-pool.mjs` compara `connection_limit` 1, 2 e 3 em um único processo Prisma, com três lotes de três `SELECT pg_sleep(80ms)` por configuração. Antes de cada lote ele exige ao menos dez conexões livres pela visão PostgreSQL e encerra se a margem não existir ou ocorrer erro. Ele nunca consulta ou altera dados funcionais. Por usar o projeto compartilhado atual, exige as quatro confirmações abaixo, inclusive uma autorização específica de leitura para este teste:

```powershell
$env:QA_ALLOW_SHARED_DATABASE_READ_BENCHMARK = 'true'
$env:QA_PROJECT_REF = 'ioebcdpyrszokdyaoaqv'
$env:CONFIRM_SUPABASE_PROJECT_REF = 'ioebcdpyrszokdyaoaqv'
$env:QA_ARTIFACT_DIR = 'docs/auditoria-2026-10-27/evidencias-capacidade-concorrencia'
node --env-file=.env tools/qa/inspect-prisma-pool.mjs
node --env-file=.env tools/qa/benchmark-prisma-pool.mjs
```

O benchmark informa p50/p95/máximo da consulta, pico de fila/conexões ocupadas/abertas, histograma de espera Prisma e margem PostgreSQL observável. `pg_stat_activity` não revela o limite de clientes/servidores do PgBouncer; isso precisa ser confirmado no Dashboard/admin antes de extrapolar para Vercel. As métricas Prisma estão em preview no Prisma 6 e precisam ser trocadas por instrumentação estável antes de Prisma 7.

`validate-financial-http.ts` aceita `QA_API_CONNECTION_LIMIT=1|2|3` somente para o processo local que inicia, sem alterar `.env` ou Vercel, e preserva `pool_timeout` de dez segundos. `QA_TIMINGS=true` habilita tempos por consulta sem SQL/parâmetros e amostras da fila Prisma. `QA_RAPID_NAVIGATION=true` executa navegação autenticada rápida em browser; requer as mesmas proteções e autorização sintética da seção de escrita remota. Pare o ensaio assim que houver fila crescente, chamadas pendentes ou qualquer sinal de saturação. Não use este modo como teste de carga.

O run de capacidade registrado em `docs/auditoria-2026-10-27/evidencias-capacidade-concorrencia/` encontrou fila de aquisição sob pool 1 e interrompeu a navegação após chamadas locais pendentes. Os três fluxos reais de browser com persistência devem aguardar uma janela aprovada e confirmação de capacidade do pooler. Os artefatos desta execução mantêm logs sem SQL nem valores, saídas de testes e evidências sintéticas; não os mova para o repositório público.

### Navegação controlada com pool local 2 — 2026-10-28

`validate-pool2-navigation.ts` inicia exatamente um processo Nest local, sobrescreve `connection_limit=2` apenas nesse processo e mantém `pool_timeout` do `.env`. O Nest usa CWD temporário sem `.env`, para impedir que `ConfigModule` recarregue credenciais SMTP, VAPID, cron ou integrações removidas do processo filho. A web recebe somente as variáveis públicas necessárias.

O preflight reutiliza uma única conta administrativa QA ativa, testa identidade Supabase/PostgreSQL, Auth signup, permissões, limite de conexões e margem do rate limit. O browser real verifica conexão e CORS, login por link de uso único sem envio de e-mail, dashboard e navegação. Os cenários vão de uma a duas sessões e só chegam a três se duas sessões mantiverem fila nula/baixa, chamadas encerradas e p95 abaixo de 8 s. Cada etapa tem timeout; quatro esperas no pool, P2024, 401/403/429/5xx, excesso de chamadas ou chamadas pendentes interrompem o run. Não grava registros jurídicos/financeiros; login pode gerar `activity_events`, contador `api_rate_limits` e atualizar `users.lastLoginAt` da identidade QA. As evidências não contêm IDs, tokens, SQL ou dados de clientes.

A origem local do browser foi ajustada para `localhost` após o bloqueio de origem do HMR observado nas primeiras tentativas. O probe `qa-navigation-pool2-1793220589241-6d91c2` autenticou o administrador sintético e confirmou que telemetria não refaz GETs, mas duas sessões do mesmo administrador chegaram a oito consultas aguardando em 1,38 s; não houve P2024 e a terceira sessão não foi iniciada. A navegação completa de uma sessão (`qa-navigation-pool2-1793220919634-6c9391`) passou por dashboard, clientes e processos, mas, ao abrir financeiro/despesas, atingiu quatro esperas e dez chamadas incompletas em 23,65 s. O p95 das nove respostas concluídas foi 4,52 s. O runner interrompeu o cenário, sem chegar a documentos/tarefas ou a fluxos com escrita; não houve P2024 nem alteração nas entidades de negócio.

`ClientManagement` também não propagava ao componente pai o cliente selecionado, impedindo o POST esperado de `client-views`. O callback agora chama `openClient(id)` e um teste Playwright verifica o evento e o `clientId`. O browser real confirmou zero GET repetidos de clientes por causa dos POSTs de telemetria. A estabilidade do pool 2 segue reprovada: a tela financeira abre vários endpoints distintos em paralelo, e cada requisição executa membership, rate limit persistido e handler. Consulte `docs/auditoria-2026-10-27/ESTABILIZACAO_NAVEGACAO_POOL2.md` e os artefatos JSON/logs ao lado para as medições completas.

```powershell
$env:QA_ALLOW_REAL_SYNTHETIC_NAVIGATION = 'true'
$env:QA_PROJECT_REF = 'ioebcdpyrszokdyaoaqv'
$env:CONFIRM_SUPABASE_PROJECT_REF = 'ioebcdpyrszokdyaoaqv'
$env:SUPABASE_PROJECT_REF = 'ioebcdpyrszokdyaoaqv'
$env:PRODUCTION_SUPABASE_PROJECT_REF = 'ioebcdpyrszokdyaoaqv'
$env:QA_API_CONNECTION_LIMIT = '2'
$env:QA_ARTIFACT_DIR = 'docs/auditoria-2026-10-27/evidencias-navegacao-pool2'
node --env-file=.env --import tsx tools/qa/validate-pool2-navigation.ts
```

O pool 2 fica candidato exclusivamente para uma instância local. Não configure Vercel até verificar o host e limite efetivos do `DATABASE_URL` publicado, o máximo de instâncias/concurrency da Function, limites de clientes/servidores do Supavisor e conexões utilizadas por outros serviços. `pg_stat_activity` conta conexões do PostgreSQL e não substitui os limites de clientes do pooler.
