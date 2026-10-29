# Homologação para release candidate — 2026-10-29

Estado após execução CI: **não aprovado para piloto comercial**. Código testado: `c943da129d1972f2f6da7321650f0a9c2841677d`, branch `validation/gha-ci-20261029`. Execução verde: [GitHub Actions #40934607266](https://github.com/steveejobs/controle-livio/actions/runs/40934607266). Artefatos `integrated-supabase-browser-evidence` e `playwright-report` publicados nessa execução.

## Alterações e validação

- Cadastro de cliente passou a ser criado pelo formulário no E2E integrado; o teste verifica POST/201, campos enviados, feedback, ficha aberta e persistência após recarga.
- Tarefa ganhou seletor de responsável da equipe ativa do tenant. A API retorna apenas id/nome, exige `tasks:create` e nega ator cliente. O E2E cria, atribui advogado e conclui pelo formulário. Fixture mockada coberta em 360 e 1440 px.
- Exceções arbitrárias de erro 500 deixaram de ser serializadas nos logs. Teste verifica que token de assinatura, dados bancários e valor financeiro não aparecem em log/resposta.
- Multer atualizado pontualmente para 2.5.0, mantendo NestJS 11. Audit de produção agora mostra três avisos altos na cadeia Prisma/config/deepmerge-ts.
- Restauração descartável: dump sintético restaurado com sucesso em database novo no PostgreSQL efêmero. As 45 tabelas públicas, dados, constraints, policies, RLS forçada e triggers foram comparados. Duração: 7,139 ms. Relatório: `restore-rehearsal.json` no artefato integrado.

Gates da execução verde: formatação, ESLint, TypeScript, Prisma Validate, builds API/web, limite do bundle, Vitest API 146 + web 30 + shared 17 (**193/193**), Playwright mockado (**21/21**), RLS/Auth/Storage e Playwright integrado (**9/9**). A restauração sintética também passou.

## Jornadas

| Jornada                | Resultado observado                                                                            | Pendência para aceite operacional                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Cliente                | Criado pelo formulário real, feedback/persistência confirmados                                 | Completar variantes de erro e viewport mobile com API real                                     |
| Processo e advogado    | Registros/atribuição/permissões cobertos no CI, preparação ainda usa API direta                | Criar e atribuir pelo formulário real; o formulário atual não seleciona advogado               |
| Contrato e recebível   | Persistência coberta no CI anterior; criação deste fluxo usa API direta                        | Criar ambos pelo formulário e verificar saldo exato por parcela na UI                          |
| Pagamento              | Formulário real, confirmação, registro e relatório passaram                                    | Repetir para saldo remanescente/baixa total e erros de concorrência pela UI                    |
| Despesa                | Cadastro, aprovação independente e quitação em formulários reais passaram                      | Repetir em viewport mobile e conferir permissões/erros nos dois perfis                         |
| Documento e assinatura | Download/assinatura no browser passaram                                                        | Upload e solicitação do link ainda são preparados via API; testar erro de upload/link expirado |
| Tarefa                 | Criação, responsável e conclusão pelo formulário passaram                                      | Executar o mesmo fluxo com API real em mobile e perfil sem permissão                           |
| Portal do cliente      | Acesso ao próprio documento/mensagem; documento interno retorna 404 e troca de organização 401 | Preparar outro cliente da mesma organização e provar negação explícita de seus registros       |

O E2E integrado usa Chromium desktop. E2E mockado passou em 360/1440 px, mas isso não equivale a testar todas as jornadas com API real em celular. Feedback visual foi assertado nos fluxos cobertos; matriz de erros completa permanece pendente.

## Performance observada

Runner Linux hospedado, Supabase temporário, uma sessão e também duas sessões/organizações. Valores são do runner e conjunto sintético, não SLO de produção.

| Área       | Requisições | API p95 | Carga percebida |
| ---------- | ----------: | ------: | --------------: |
| Dashboard  |           4 |   56 ms |          697 ms |
| Clientes   |           2 |   28 ms |          610 ms |
| Processos  |           3 |   30 ms |          566 ms |
| Financeiro |           3 |   71 ms |          633 ms |
| Despesas   |           5 |   46 ms |          575 ms |
| Documentos |           4 |   36 ms |          595 ms |
| Tarefas    |           2 |   21 ms |          563 ms |

No ensaio: 1.207 consultas Prisma, p50/p95 de consulta 0/5 ms (p50 arredondado), espera de pool p50/p95 1/1 ms, máximo 2 consultas aguardando, 4 conexões abertas/ocupadas e zero P2024. Rajada autenticada: 6 chamadas compartilharam 2 consultas de membership (4 deduplicadas). Navegação autenticada terminou sem requisições pendentes ou erros; um 401 de `/auth/me` antes do login é parte esperada do setup.

## Segurança e serviços

Audit atualizado depois do override de Multer: produção tem **3 altas** (Prisma, `@prisma/config`, `deepmerge-ts`); árvore completa tem **9** (2 críticas, 3 altas, 1 moderada, 3 baixas), concentradas em ferramentas de desenvolvimento/teste e dependências Prisma/Nest CLI. Vitest/tinypool permanecem no grupo crítico de desenvolvimento; Prisma 7.10.1 e Vitest 5 seriam mudanças major e não foram aplicadas. Isso bloqueia declarar segurança pronta. Avisos: [Multer](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) foi corrigido; [deepmerge-ts](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) segue no audit.

Uploads continuam bufferizados, com limites por arquivo, e não há scanner antimalware homologado. A correção dos logs cobre exceções do filtro global; revisão adicional de logs de aplicação e de anexos continua necessária.

SMTP é necessário para convites e recuperação automáticos, mas envio/caixa de testes não foram homologados. Push precisa de VAPID e adesão de dispositivo. Agendadores são dependência de avisos financeiros, tarefas/audiências e alertas de acesso; o workflow local não valida a configuração hospedada. Realtime e Edge Functions não apareceram como dependência obrigatória destas jornadas e não foram adicionados.

## Limites de recuperação

O ensaio **não restaurou o backup histórico previamente exportado**: produziu e restaurou um dump sintético dentro do Postgres descartável. O destino foi um database de nome aleatório, sem sobrescrita. Foram excluídos owners/grants e extensões/jobs cron/net para impedir efeitos externos. Não foram recuperados arquivos do Storage, configuração/Auth hosted, segredos ou arquivos externos. Portanto, provar recuperação de backup real, Storage e Auth/memberships ainda é requisito para o primeiro escritório.

## Pendências para o primeiro escritório

1. Completar por formulário as jornadas de processo/responsável, contrato/recebível e upload/solicitação de assinatura; verificar saldo exato e o isolamento entre dois clientes da mesma organização.
2. Executar fluxos essenciais em mobile com API real, incluindo erros, ausência de permissões e confirmação financeira.
3. Mitigar três avisos altos de produção e os dois críticos de desenvolvimento sem upgrades major não avaliados; repetir audit e gates depois das correções.
4. Definir limite agregado de memória para uploads e prover scanner antimalware antes de aceitar anexos reais.
5. Configurar SMTP autenticado e domínio remetente, testar em caixa controlada sem destinatários reais; homologar VAPID/push se o escritório usar notificações móveis e confirmar schedulers hospedados.
6. Restaurar o backup histórico em projeto completamente isolado, incluir política/cópia de Storage e testar recuperação Auth/memberships, integridade, acesso a documentos e tempos de RPO/RTO.
7. Planejar promoção gradual, rotação de credenciais e monitoramento de erros/pool. Nenhum passo desta execução alterou Supabase compartilhado ou produziu deploy.

## Proteções e classificação

Os dois projetos ligados foram confirmados (`controle-livio`/`apps/api`, `controle-livio-web`/`apps/web`). Os arquivos Vercel no commit testado têm `git.deploymentEnabled.validation/gha-ci-20261029=false`. Consulta de deployments filtrada por branch encontrou tentativas históricas do projeto API em estado `CANCELED`, zero deployments da branch no projeto web e nenhum Preview ativo/Ready. A `main` não foi alterada.

FUNCTIONAL_READY: PARTIAL

UX_READY: PARTIAL

PERFORMANCE_READY: PARTIAL

SECURITY_READY: NO

BACKUP_RESTORE_READY: PARTIAL

COMMERCIAL_PILOT_READY: NO

RELEASE_CANDIDATE_READY: NO

## Sprint de fechamento do primeiro cliente — atualização local (2026-10-29)

Esta atualização descreve alterações ainda locais sobre a branch `validation/gha-ci-20261029`, cujo HEAD base é `8de04ad72ac16778a6213a9ddf1016652c7caeda`. A Actions #40936072471 é evidência do commit base; ela não executou este lote. Nenhum push, deploy, migration ou acesso ao Supabase compartilhado foi feito.

### Mudanças preparadas

- Processo: o formulário E2E agora seleciona cliente, fluxo e advogado; a API lista somente advogados ativos da organização, exige permissão de criação e rejeita responsável que não tenha o papel `lawyer`. A leitura do processo passa a apresentar o nome do responsável.
- Financeiro: recebíveis podem ser associados a contrato pelo formulário; a tela mostra saldo por recebível e parcela. O saldo usa unidades inteiras de 4 casas decimais. O E2E cobre divisão de R$ 100,00 em R$ 33,34 + R$ 33,33 + R$ 33,33, vencimentos mensais, pagamento parcial, quitação, saldo zero, excesso, referência duplicada e retry idempotente após perda simulada da resposta.
- Documentos: formulários de documentos e anexos informam o limite de 4 MiB. API valida tamanho, conteúdo/magic bytes, quantidade de arquivos/campos/partes e o tamanho declarado da requisição; duas operações bufferizadas por processo podem ocorrer ao mesmo tempo. O E2E inclui upload/download/solicitação de assinatura e rejeição de tipo e tamanho inválidos.
- Varredura: API envia arquivos em blocos ao ClamAV antes de gravar no Storage, rejeita arquivos infectados e falha fechada se o scanner não responder. O bypass existe somente para `SUPABASE_ENVIRONMENT=test` com `SUPABASE_LOCAL=true`. A unidade usa um servidor TCP sintético; ainda falta homologar uma instância ClamAV real e assinaturas atuais.
- Portal: fixtures incluem segundo cliente no mesmo escritório e cliente de outra organização; o E2E verifica visibilidade do próprio documento e negação dos demais. Essas novas jornadas ainda aguardam execução integrada.
- Dependências: Vitest foi atualizado pontualmente para 4.1.12 para retirar os dois avisos críticos de Vitest/tinypool; scripts e transformação JSX dos testes foram ajustados. A árvore segue com três alertas altos associados à cadeia `prisma` / `@prisma/config` / `deepmerge-ts`; não foi feita a migração major do Prisma 6 para 7.

O teto de 4 MiB preserva margem frente ao limite de corpo de 4,5 MB das Vercel Functions. Uploads maiores precisam de uma arquitetura de envio direto ao Storage com quarentena/varredura; elevar o limite da API não é compatível com o runtime Vercel atual.

### Evidência e limites desta atualização

- Validações locais executadas: Vitest, TypeScript, ESLint, `Prisma Validate` e builds API/web. O total e as execuções serão atualizados após repetir os gates finais do lote.
- Formulários E2E, isolamento de portal e rejeições de upload foram escritos, mas não executados neste estado local. Os 9/9 Playwright integrados da Actions #40936072471 pertencem ao commit base e não comprovam estas alterações.
- Proteção Vercel consultada em leitura nos dois projetos: `controle-livio` e `controle-livio-web` usam `ssoProtection.deploymentType=all_except_custom_domains`. Os arquivos `vercel.json` da branch desabilitam deployment automático de `validation/gha-ci-20261029`. Nenhuma nova tentativa/deployment foi criado neste lote.
- Este checkout não contém um dump histórico de produção. O restore de 45 tabelas citado acima foi sintético, em banco temporário; Auth, owners/grants, jobs e objetos Storage reais não foram restaurados. Não há evidência para declarar recuperação operacional de backup.
- SMTP local está habilitado no Supabase de teste, mas envio/captura de convite ou recuperação ainda não foi homologado. Push/VAPID não é necessário para concluir as jornadas testadas. Os crons hospedados e o segredo de autorização não foram executados/confirmados neste lote; Realtime e Edge Functions não são dependências dos fluxos avaliados.

| Critério                      | Estado após este lote local | Evidência/pendência principal                                                                                                                   |
| ----------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `FORM_WORKFLOWS_READY`        | PARTIAL                     | Fluxos foram escritos para formulários reais; nova execução GitHub Actions pendente e operações desktop ainda precisam de validação específica. |
| `FINANCIAL_INTEGRITY_READY`   | PARTIAL                     | Cálculos e asserts de centavos/4 casas adicionados; integração financeira desta revisão ainda não foi executada.                                |
| `PORTAL_ISOLATION_READY`      | PARTIAL                     | Fixtures e asserts same-tenant/cross-tenant adicionados; aguardam Playwright/API reais no runner.                                               |
| `UPLOAD_SECURITY_READY`       | PARTIAL                     | Limite 4 MiB, validação e scanner fail-closed preparados; falta scanner ClamAV real e execução integrada.                                       |
| `DEPENDENCIES_SECURITY_READY` | PARTIAL                     | Alertas críticos removidos por Vitest 4.1.12; os três altos Prisma/deepmerge permanecem no audit.                                               |
| `BACKUP_RECOVERY_READY`       | PARTIAL                     | Restore sintético anterior passou; backup histórico e Auth/Storage reais não estão disponíveis neste repositório/destino.                       |
| `EXTERNAL_SERVICES_READY`     | PARTIAL                     | SMTP de captura existe na stack local mas não foi testado; configuração hospedada de ClamAV/crons/SMTP depende do primeiro escritório.          |
| `COMMERCIAL_PILOT_READY`      | NO                          | Integração deste lote, scanner hospedado, backup real e serviços operacionais ainda não homologados.                                            |
| `RELEASE_CANDIDATE_READY`     | NO                          | Não há execução GitHub Actions deste lote nem prova de restauração real.                                                                        |

## Validação local complementar do sprint (2026-10-29)

- Gates locais depois das correções: `npm run typecheck`, `npm run lint`, `npm run db:validate`, `npm run build` e `npm test` passaram. Vitest totalizou 204/204 (API 155, web 30, shared 19). Prisma avisou que o preview `metrics` está depreciado.
- O bundle inicial ficou em 253.015 bytes gzip (limite do projeto: 260.000). ESLint passou sem warnings.
- O Playwright mockado teve 17 cenários aprovados na primeira execução. Quatro encontraram stubs desatualizados após a consulta de advogados e a carga de contratos no formulário financeiro; os stubs foram atualizados e os quatro cenários afetados passaram isoladamente. Assim, há evidência local de 21 cenários aprovados em duas execuções; o gate consolidado do GitHub ainda deve ser repetido.
- `npm run format:check` percorreu também `integrated-playwright-report.json`, artefato local não rastreado, e falhou somente nesse JSON. Esse artefato não será incluído no commit; a validação Prettier dos arquivos versionados e do código novo deve ser confirmada pelo gate limpo do GitHub.
- O audit atual retorna 0 críticos, 0 moderados, 3 altas e 3 baixas na árvore completa. `npm audit --omit=dev` ainda mostra a cadeia `prisma` → `@prisma/config` → `deepmerge-ts` (GHSA-ggr8-5vv4-36mx); a correção automática indicada requer Prisma 7.10.1, upgrade major. Os críticos anteriores em Vitest/tinypool foram removidos pela atualização pontual para Vitest 4.1.12. A cadeia Prisma não foi alterada sem plano de compatibilidade.
- Playwright integrado contra Supabase temporário e restore sintético continuam pendentes para este novo commit. Nenhuma evidência da execução #40936072471 foi atribuída a este lote.

## Análise da exposição de dependências (2026-10-29)

- Os dois alertas críticos anteriores eram `GHSA-5gmw-xhrv-c9v3` e `GHSA-85c8-ppgw-ccpr`, falhas de prototype pollution em opções de workers do Tinypool que podem permitir execução de código no worker. A cadeia crítica deixou a árvore instalada após Vitest 4.1.12; a versão corrigida do Vitest também cobre os avisos de `@vitest/mocker`. Fontes: https://github.com/advisories/GHSA-5gmw-xhrv-c9v3, https://github.com/advisories/GHSA-85c8-ppgw-ccpr, https://github.com/advisories/GHSA-qxg6-89mg-rqv8.
- CI executa código de PR, então uma tomada do runner continua relevante. O workflow desta branch limita permissões a `contents: read`, define `persist-credentials: false`, não usa segredos e aponta dependências para loopback/placeholders; reduz o impacto sobre GitHub e serviços compartilhados, mas não substitui corrigir a cadeia. A mudança foi exercitada nos testes locais; Actions deste lote aguarda autorização de push.
- O high remanescente é `GHSA-ggr8-5vv4-36mx`: `deepmerge-ts` abaixo de 8 pode entrar em recursão sem fim em dois grafos cíclicos, causando indisponibilidade. O pacote chega por `prisma@6.19.3 → @prisma/config@6.19.3`; o npm continua detectando-o com `--omit=dev` via peer opcional do `@prisma/client`. O call site de merge é a configuração Prisma local; a advisory descreve objeto recursivo controlado, e não encontramos entrada HTTP do produto chegando a esse call site. Ainda assim, o pacote consta na árvore instalada e o audit o mantém alto.
- O audit sugere Prisma 7.10.1, mudança major. Um override consumer de `deepmerge-ts@8.0.2` foi tentado, mas a resolução/lock permaneceu em 7.1.5 e o audit não mudou; o override foi removido. Não contamos essa tentativa como mitigação. O bloqueio requer versão compatível publicada pelo Prisma ou migração isolada/validada do Prisma, com `generate`, `validate`, testes e builds.
- Referência do alerta alto: https://github.com/advisories/GHSA-ggr8-5vv4-36mx. A validação real de ClamAV e CI deste lote continuam pendentes.

## Fechamento da validação local (2026-10-29)

- Depois de uma instalação limpa por `npm ci`, o gate consolidado local terminou verde: Vitest 204/204 (API 155, web 30, shared 19), TypeScript, ESLint sem warnings, Prisma Validate, build API/UI/web e bundle.
- Bundle inicial: 253.015 bytes gzip para limite de 260.000. Prisma Validate reporta apenas a depreciação conhecida da preview `metrics`.
- Playwright mockado consolidado: 21/21. Os novos stubs para `GET /matters/responsibles/lawyers` e `/finance/contracts` passaram com o restante da suíte.
- Prettier passou nos arquivos suportados do lote. O comando global local ainda encontra o arquivo não rastreado `integrated-playwright-report.json` e o sinaliza; ele foi preservado fora do commit. O runner limpo do GitHub deve confirmar `format:check`.
- `playwright --list --config playwright.integrated.config.ts` listou 9 testes. As seis jornadas de formulário foram parametrizadas para 360×800 e 1440×900, cada viewport com contexto separado. A execução integrada nova não foi feita: aguarda publicação autorizada para o Supabase temporário do Actions.
- `npm audit --omit=dev` continua com 3 altas na cadeia Prisma/deepmerge-ts; a árvore completa mantém também 3 baixas de ferramentas. Não há críticos ou moderados após Vitest 4.1.12. A tentativa de override do Prisma não foi efetiva e foi retirada.
- Nenhum commit foi publicado, nenhum workflow deste lote iniciou, e não houve deploy, migration ou acesso de escrita ao Supabase compartilhado. Antes de eventual push, os projetos Vercel foram relidos: `all_except_custom_domains` nos dois e `git.deploymentEnabled.validation/gha-ci-20261029=false` em ambos.
