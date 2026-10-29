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
