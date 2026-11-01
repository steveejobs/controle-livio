# Auditoria de acesso e sessão — 2026-10-31

## Causa observada

- A interface convertia todo HTTP 401 em “Sua sessão expirou”, inclusive a recusa de e-mail/senha pelo Supabase Auth e as recusas da API por ausência de vínculo ativo ou seleção de organização. A mensagem, portanto, não prova expiração do token. O código local agora exibe o motivo recebido e mostra a falha de `/auth/me` após autenticação por senha.
- Às 17h08 e 17h11 (America/Sao_Paulo), a web de produção recebeu visitas. A API respondeu 500 ao preflight `OPTIONS /v1/auth/me` no deployment `dpl_GuZCSBVmVj33euwwKB8S9wwksedJ`. Os logs apontam falha de inicialização: `MAX_DOCUMENT_SIZE_MB` acima de 4 e `CLAMAV_HOST` ausente. O mesmo deployment falhou repetidamente no cron e no smoke de `/v1/health/live`. Não há evidência de que um JWT específico tenha expirado.
- O alias público `controle-livio.vercel.app` ainda resolvia para esse deployment defeituoso durante a auditoria. Foi reassociado ao deployment anterior `dpl_6yjRxg682u9ZbL5MWZcgMQZUZivq`. Após a correção, web, `/v1/health/live` e `/v1/health/ready` responderam 200. Nenhuma configuração de variável, migration ou dado de negócio foi alterado.

## Acessos e perfis

- Consulta somente leitura de `activity_events` encontrou 30 eventos `SYSTEM_ACCESS` nos últimos sete dias; os mais recentes são de 28/10. Há eventos de administrador e cliente. O evento só existe quando `POST /auth/access` conclui, portanto sua ausência não demonstra que ninguém tentou entrar.
- No banco compartilhado há três memberships ativas com usuário e organização ativos: duas com papel administrador e uma com papel cliente. Nenhuma membership ativa possui papel advogado, secretaria ou financeiro. Assim, não há conta de colaborador ativa nesse alvo para homologar login real.
- O guard da API exige token válido, membership e organização ativas e permissões por rota. O código e os testes locais cobrem isolamento e permissões; a execução integrada anterior em Supabase descartável cobriu papéis, mas não comprova o checkout local de 31/10.
- Logs da Vercel não contêm identificação da conta nos registros consultados. Não se pode vincular as duas visitas observadas ao usuário que relatou a mensagem sem horário e identidade adicionais.

## Validação e limites

- Correção local em `apps/web/features/shared/crm-ui.tsx` e `apps/web/features/app/legal-crm.tsx`; teste de regressão em `crm-ui.test.tsx` confirma que senha inválida e vínculo ausente mostram mensagens distintas.
- Format check, lint, TypeScript, Vitest 257/257, Prisma Validate e builds API/web passaram. A suíte Playwright mockada iniciou 21 cenários, aprovou os dois administrativos (360/1440 px) e parou de progredir no seguinte neste Windows; foi interrompida. Uma tentativa dirigida aprovou o portal do cliente em 360 px antes de também ser interrompida. Não há aprovação da suíte completa nesta rodada.
- O ambiente atual de `.env` está ligado a Production/Preview. O teste de uso completo com criação de registros, login de colaborador e Auth/RLS/Storage reais requer projeto TEST/DEV isolado e contas sintéticas. Nenhuma escrita de QA foi feita no banco compartilhado nesta auditoria.
- Atualização de 31/10: o hotfix da web foi publicado a partir da `main` na PR em rascunho [#1](https://github.com/steveejobs/controle-livio/pull/1), commit `ba1a9b8`, deployment `dpl_DgnASidnQrWVzEEFsyRGospAhfnb`. O Quality da PR passou em format, lint, TypeScript, testes, Prisma, builds, Playwright mockado e isolamento Supabase. Após associar o alias público à versão final, web, API live e ready responderam 200. A API nova com ClamAV continua inapta a substituir a versão anterior sem scanner alcançável e limite de upload alinhado.
