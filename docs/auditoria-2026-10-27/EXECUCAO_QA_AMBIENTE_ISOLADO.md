# Execução QA em ambiente isolado

**Data:** 2026-10-27  
**Status geral:** **BLOCKED** — não há destino TEST/DEV cloud independente confirmado nem acesso administrativo para provisioná-lo. Este relatório não declara nenhuma jornada integrada como funcional nesta etapa.

## Respostas do fechamento

| Pergunta                                      | Resultado verificado                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ambiente independente criado ou identificado? | **Não.** O único `.env` local aponta para serviços remotos e `SUPABASE_LOCAL=false`. A documentação do repositório liga a ref configurada a Vercel Production e Preview. Nenhum projeto TEST separado foi comprovado.                                                                       |
| Separação da produção comprovada?             | **Não.** Não foi possível listar projetos pelo Supabase Dashboard/CLI. A integração disponível é somente leitura e a auditoria anterior já a identificou como outra ref, sem relação com o app. Não há autorização/accesso cloud suficientes para criar recursos.                           |
| Schema reproduzido no TEST?                   | **Não.** Nenhuma conexão de escrita ou migration foi executada.                                                                                                                                                                                                                             |
| Auth e Storage funcionam no TEST?             | **Não verificado.** Não existe endpoint TEST isolado; os testes anteriores apontaram para a ref conectada a Production/Preview.                                                                                                                                                             |
| Migrations consistentes?                      | **Parcialmente analisado em fonte:** sequência local de 16 migrations e dependências `pg_cron`/`pg_net` identificadas. Prisma validate local passou na etapa anterior. Consistência contra banco TEST não pode ser afirmada sem destino; nenhum diff de banco foi feito.                    |
| Jornadas executadas nesta etapa?              | Nenhuma operação de negócio foi executada. Nenhum usuário, cliente, escritório ou arquivo foi criado nesta etapa.                                                                                                                                                                           |
| Qual o próximo passo bloqueante?              | Responsável cria ou indica projeto TEST no Dashboard, confirma ref/URL/host e separação das refs Vercel Production/Preview, autoriza migrations e dados sintéticos nessa ref e fornece acesso por secret manager/arquivo local ignorado. Ver detalhes em `docs/infra/AMBIENTE_TEST_DEV.md`. |

## Inventário seguro

- Branch `main`, HEAD `919a5accc91bc96dbd87773411668d017f968e35`; no início, 81 arquivos rastreados modificados e 48 entradas não rastreadas. Todos foram preservados.
- Só existe `.env` raiz; não existe env TEST separado para API/web. O projeto configurado é remoto e está documentado como conectado a Production/Preview.
- Docker e Supabase CLI não estão instalados. A configuração local `supabase/config.toml` descreve portas e serviços locais, mas não prova que existam processos em execução.
- `supabase/seed.sql` é configurado para o ambiente local e contém identidades e registros de teste com domínio de e-mail `.test`; não foi aplicado nem copiado para projeto cloud.
- O scanner estático encontrou 16 migrations em ordem cronológica e as extensões `pg_cron`/`pg_net`. Configuração de Vault/job é separada e usa `livio_notifications_api_url`; nenhum destino foi provisionado.
- Nenhum valor de `.env`, service-role key, senha de banco ou token foi impresso ou registrado.

## Jornadas

Os estados referem-se à validação integrada nesta etapa. `NOT_RUN` significa que a operação foi preparada/planejada, mas não executada; o bloqueio comum está registrado separadamente. Não houve PASS ou FAIL funcional porque o sistema não foi conectado a um alvo TEST autorizado.

| Jornada                 | Estado      | Evidência desta etapa                                                                                                                                              | Dependência para executar                                                     |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Clientes e processos    | **NOT_RUN** | Harness atualizado prepara contato, cliente, processo, responsável, status/etapa/histórico e autorização entre papéis/organizações.                                | Supabase TEST confirmado, migrations e usuários sintéticos por papel.         |
| Contratos e financeiro  | **NOT_RUN** | Cenários preparados para pagamento parcial/concorrente/idempotente, excesso, saldo, relatório e isolamento usando valores string Decimal.                          | Recebível/contrato sintético e PostgreSQL TEST.                               |
| Despesas                | **NOT_RUN** | Endpoint existente de criação/listagem identificado; transições de aprovação/pagamento não foram encontradas.                                                      | Banco TEST e decisão de produto antes de qualquer transição.                  |
| Documentos e assinatura | **NOT_RUN** | Harness exige DOCX anterior/PDF atual, hash e tamanho persistidos, download assinado/expiração, upload, assinatura sintética e revogação. Não foi executado.       | Buckets privados TEST, políticas aplicadas e API local com service role TEST. |
| Tarefas e agenda        | **NOT_RUN** | Harness preparado para tarefa, histórico, audiência e lembretes. Migrations incluem `pg_cron`/`pg_net`; cron não configurado para TEST e API host allowlist vazia. | API TEST não produtiva aprovada para job ou dispatch manual controlado.       |
| Portal do cliente       | **NOT_RUN** | Harness preparado com vínculo explícito `clientId`, JWT cliente, documents visibility, mensagens/notificações, finanças e tentativas administrativas/RLS.          | Client sintético, JWT próprio, policies e grants do TEST reproduzidos.        |

## Proteções locais aplicadas

1. O verificador QA compara projeto/ref com URLs Supabase públicas e server-side, chave anônima web/API e identidades de `DATABASE_URL` e `DIRECT_URL`. Preflight consulta serviços reais em modo de leitura.
2. Escrita remota exige `SUPABASE_ENVIRONMENT=test`, `QA_EXTERNAL_DELIVERY_DISABLED=true`, ausência de credenciais de saída, ref em allowlist versionada, ref de Production conhecida e diferente, e RLS esperado. A allowlist de projetos remotos permanece vazia.
3. O verificador bloqueia `NEXT_PUBLIC_*` que contenha service role, segredo, chave privada ou token. Service role continua fora da web e nunca é usada para simular usuários.
4. O provisionador `tools/notifications/provision-runtime.mjs` podia aceitar `SUPABASE_ENVIRONMENT=test` e, ainda assim, adicionar segredos no Vercel Production. Ele agora aceita somente a ref Production verificada e rejeita configuração de QA.
5. O configurador de scheduler agora bloqueia destinos TEST sem host de API em allowlist versionada. A allowlist está vazia; URLs Production/Preview são negadas para projeto TEST.
6. Variáveis de integração externa abrangem SMTP/mail, push/VAPID, CRON, cobrança, mensagens e webhooks; a execução QA falha se forem configuradas. A configuração do Supabase Dashboard para e-mail/SMTP e qualquer integração cloud ainda precisa de verificação humana antes de liberar escrita.

Nenhum dos guardrails foi usado para escrever em cloud nesta etapa. Nenhuma migration, alteração Auth/Storage, provisionamento de chaves, configuração de Vercel ou deploy ocorreu.

## Problemas e dependências encontrados

- O ambiente atual não é isolado: a mesma ref é informada como conectada a Production/Preview. Os testes integrados anteriores foram conduzidos antes de essa associação ser evidenciada; nesta execução, esse destino foi bloqueado.
- Não existe acesso Supabase de administração ou CLI/Docker local. A integração Supabase conectada só lista/consulta o projeto que tem vinculado; não lista ou cria projetos para esta organização.
- Existe risco operacional no fluxo de notificações: as migrations habilitam `pg_cron`/`pg_net`, e o script de configuração grava a URL de destino no Vault. Um alvo TEST incorreto poderia chamar a API de produção. O scheduler TEST permanece sem host autorizado e sem configuração.
- Não houve comparação entre o schema SQL aplicado e o Prisma em um projeto TEST. `prisma validate` local verifica o schema Prisma, não prova aplicação/consistência de migrations.
- SMTP, VAPID, cobrança, WhatsApp e webhooks reais não são necessários para o próximo teste e devem permanecer sem credenciais. Assinatura dos documentos será sintética.
- Despesas seguem incompletas no produto: há criação/listagem no código, sem endpoints de aprovação/pagamento encontrados. Definição funcional é dependência, não falha a contornar via QA.

## Validações locais e arquivos

`tools/qa/verify-workflows.ts` passou em TypeScript estrito isolado; ESLint, Prettier, Prisma validate e `node --check` dos provisionadores passaram após os guardrails. Uma execução negativa local confirmou que o provisionador Vercel recusa `SUPABASE_ENVIRONMENT=test` antes de gerar/gravar segredos ou chamar a nuvem. Não houve migration, teste integrado remoto ou build/deploy nesta etapa. A evidência anterior de 155 testes e build completo consta na validação integrada anterior e não é apresentada como teste deste ambiente.

Arquivos tocados nesta etapa:

- `tools/qa/verify-workflows.ts`
- `tools/qa/README.md`
- `tools/notifications/provision-runtime.mjs`
- `tools/notifications/configure-scheduler.mjs`
- `tools/notifications/README.md`
- `docs/infra/api.test.env.template`
- `docs/infra/web.test.env.template`
- `docs/infra/AMBIENTE_TEST_DEV.md`
- `docs/auditoria-2026-10-27/EXECUCAO_QA_AMBIENTE_ISOLADO.md`
- `PROJECT_CONTEXT.md`

Alterações preexistentes do checkout foram preservadas. Nenhum dado pessoal ou documento real foi copiado para TEST.
