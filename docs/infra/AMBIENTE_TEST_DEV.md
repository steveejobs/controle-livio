# Ambiente TEST/DEV do Lívio Jurídico

**Estado em 2026-10-27: bloqueado antes da criação/configuração cloud.** Nenhum projeto externo foi criado, nenhuma migration aplicada e nenhum deploy feito. O material abaixo prepara o procedimento e mantém o QA em fail-closed até existir um destino TEST confirmado e autorizado.

**Atualização posterior, 2026-10-27:** por decisão explícita do proprietário, foram executados testes integrados com dados sintéticos no projeto Supabase atual. Nenhum Supabase adicional, Docker, migration ou deploy foi criado/aplicado. Auth, PostgreSQL e Storage pertencem ao mesmo projeto; a ref também está associada a Vercel Production e Preview na documentação. Essa autorização não transformou o projeto em TEST isolado. Veja `docs/auditoria-2026-10-27/EXECUCAO_QA_BANCO_ATUAL.md` para resultados e dados retidos por triggers de histórico imutável.

## O que foi confirmado

- O checkout está em `main`, HEAD `919a5accc91bc96dbd87773411668d017f968e35`. Antes desta etapa havia 81 arquivos rastreados modificados e 48 entradas não rastreadas. Esse trabalho foi preservado; não houve reset, checkout destrutivo ou sobrescrita deliberada.
- Há um único `.env` de raiz, apontando para Auth, PostgreSQL e Storage remotos. `SUPABASE_LOCAL=false`. A documentação `docs/ENVIRONMENTS.md` informa que a mesma ref Supabase está configurada nos ambientes Vercel Production e Preview. Ela não é um alvo válido para QA com escrita.
- Não existe `.env.test.local` nem configuração distinta de Supabase para API/web. Os templates deste documento são arquivos vazios, sem credenciais.
- `supabase/config.toml` descreve a stack local `livio-legal-crm`, com Auth, Storage, Inbucket e seed habilitados. Não é prova de que essa stack esteja rodando. Docker e Supabase CLI não estão instalados neste computador.
- A integração Supabase disponível nesta sessão é somente leitura (SQL, extensões, migrations e tabelas), não oferece listagem/criação de projetos nem administração. O registro da auditoria anterior associa esse conector a outra ref, sem relação comprovada com este app; não foi usado como destino TEST.
- O seed local contém Auth identities/users, clientes, processos, contratos, recebíveis e notas. Os e-mails encontrados usam o domínio reservado `.test`; mesmo assim, o seed não foi executado nem copiado para cloud. Ele é apenas para a stack local após revisão dos valores e do hash de senha.
- As URLs Supabase pública e server-side e suas chaves anônimas coincidem no `.env` atual. Uma service-role key está presente no ambiente server-side; seus valores não foram exibidos nem copiados. Não foram encontradas variáveis locais SMTP, VAPID, CRON, cobrança ou webhook.

**Conclusão:** nenhum projeto TEST/DEV independente foi identificado com evidência suficiente. O projeto configurado não pode ser reutilizado para testes mutáveis. Não há acesso Supabase de administração disponível para criar ou enumerar projetos, e a solicitação não informa organização, região ou autorização de cobrança/provisionamento. Portanto, não houve operação cloud.

## Intervenção humana necessária

O responsável precisa executar ou autorizar explicitamente os seguintes itens:

1. No Supabase Dashboard, identificar um projeto TEST/DEV já existente ou autorizar a criação de um projeto novo em uma organização aprovada, definindo região e cobrança. A ref deve ser diferente da usada em Vercel Production **e** Preview.
2. Confirmar no Dashboard a ref, URL de API e host/região PostgreSQL do projeto novo; comparar a ref com os ambientes Production/Preview no Vercel Dashboard. Nome de projeto, `.env` ou `SUPABASE_ENVIRONMENT=test` não substituem essa comparação.
3. Conceder acesso operacional ao novo projeto (CLI autenticada ou credenciais colocadas diretamente em um secret manager/arquivo local ignorado pelo Git) e autorizar migrations e gravação de dados sintéticos exclusivamente nessa ref.
4. Confirmar que Auth não envia mensagens a destinatários reais, que SMTP/webhooks/cobrança/push externos estão desabilitados e que jobs de rede permanecerão inativos até existir uma API TEST explicitamente aprovada.

Não envie service-role key, senha de banco, tokens ou conteúdo de `.env` pelo chat. Com a autorização, preencha os arquivos ignorados a partir dos templates abaixo em máquina segura. Não use o `.env` atual como base e não copie dados de cliente, documentos, backups ou chaves de produção.

## Variáveis isoladas

Os templates versionados estão em:

- `docs/infra/api.test.env.template` — API local e processo QA; contém somente nomes de variável e campos vazios.
- `docs/infra/web.test.env.template` — web local; contém apenas URL e chave anônima pública.

Copie-os para `.env.test.local` e `apps/web/.env.test.local`, respectivamente; esses destinos são ignorados pelo Git. Preencha os campos vazios usando somente o painel TEST. `DATABASE_URL` e `DIRECT_URL` precisam identificar a mesma ref TEST por host/usuário. `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, chaves anônimas e `SUPABASE_PROJECT_REF` também devem corresponder ao projeto TEST. Service role fica apenas no processo de API/QA e nunca recebe prefixo `NEXT_PUBLIC_`.

Os processos da API/web devem receber esses arquivos explicitamente via `node --env-file=...`; não carregue `.env` de raiz em um processo TEST. O endpoint web aponta para `http://127.0.0.1:3021/v1`, CORS aceita somente `http://127.0.0.1:3000` e redirects Auth apontam para a callback local. Não configure wildcard de CORS nem redirect de produção.

Para uma stack local descartável, instale Docker e Supabase CLI, então use a configuração `supabase/config.toml` e as chaves locais geradas pelo CLI. O computador atual não tem esses pré-requisitos; `supabase start` ainda não pode ser executado. O seed local deve permanecer apenas local.

## Migrations e dependências de schema

A sequência SQL presente no checkout tem 16 arquivos, em ordem lexicográfica:

1. `20260807134500_initial_foundation.sql`
2. `20260807170000_finance_document_links.sql`
3. `20260807180000_supabase_auth_rls.sql`
4. `20260809120000_auth_memberships_hardening.sql`
5. `20260812150000_authenticated_table_grants.sql`
6. `20261021150000_access_alerts_and_payment_change_requests.sql`
7. `20261021160000_web_push_subscriptions.sql`
8. `20261021170000_service_catalog.sql`
9. `20261021180000_calendar_reminder_preferences.sql`
10. `20261021190000_shared_api_rate_limits.sql`
11. `20261021200000_notification_scheduler.sql`
12. `20261021210000_scheduler_request_claims.sql`
13. `20261021220000_portal_rls_scope.sql`
14. `20261021230000_portal_write_scope.sql`
15. `20261022200000_client_photos.sql`
16. `20261022213000_document_signing.sql`

O scanner estático identificou `pg_cron` e `pg_net` na migration `20261021200000_notification_scheduler.sql`. As migrations seguintes acrescentam funções, triggers, grants, policies e restrições por organização/cliente; policies de Storage e signing dependem dessa sequência. `pg_cron`/`pg_net` devem ser considerados dependências operacionais, não apenas DDL.

A migration instala extensões, mas configuração de Vault e do destino do job é feita separadamente por `tools/notifications/configure-scheduler.mjs`. O destino da chamada está guardado em `vault.decrypted_secrets`, com chave `livio_notifications_api_url`. Nunca aplique/configure o job TEST para `controle-livio.vercel.app` ou qualquer host de Production/Preview. O allowlist de hosts TEST do configurador permanece vazio; até haver endpoint TEST isolado, deixe o job inativo e valide dispatch manualmente pela API local.

O schema Prisma foi validado localmente na etapa anterior, mas isso não comprova aplicação ou compatibilidade das 16 migrations. A comparação de tabelas, índices, constraints, funções, triggers, policies RLS/Storage e extensões no destino TEST só poderá ocorrer depois da criação/identificação e autorização. Nenhuma migration foi aplicada nesta etapa. Se houver divergência SQL/Prisma, pare antes de aplicar e documente o diff em separado.

Nunca rode `supabase db reset`, seed ou migrate com `.env` atual ou sem conferir o project ref no processo. A autorização de migration deve nomear exatamente a ref TEST e permanecer distinta da autorização de criação cloud.

## Proteções instaladas no checkout

- `tools/qa/verify-workflows.ts` exige que ref declarada, `SUPABASE_URL`, URL pública, chave anônima e `DATABASE_URL`/`DIRECT_URL` correspondam. O preflight consulta Auth, PostgreSQL e Storage e valida sua identidade. Escritas remotas exigem `SUPABASE_ENVIRONMENT=test`, ref em allowlist versionada, produção em inventário verificado, RLS esperada e `QA_EXTERNAL_DELIVERY_DISABLED=true`.
- A allowlist de projetos remotos QA segue vazia. O projeto atual está explicitamente reconhecido como conectado a Production/Preview e bloqueado. `QA_ALLOW_WRITES=true` não substitui a allowlist nem a comparação externa.
- Escrita QA falha se variáveis de integração SMTP, mail, VAPID, CRON, cobrança, WhatsApp, Meta ou webhook estiverem configuradas. Segredos sob `NEXT_PUBLIC_*` também são rejeitados. Requests de autorização continuam usando tokens dos papéis sintéticos; service role é usada só para provisionamento/limpeza e leitura administrativa necessária.
- `tools/notifications/provision-runtime.mjs` escreve chaves no ambiente Vercel Production. Foi limitado à ref Production conhecida e rejeita configuração de QA, evitando gravar VAPID/CRON de um projeto TEST no Vercel Production.
- `tools/notifications/configure-scheduler.mjs` exige, para projeto TEST, ref de produção verificada, URLs e credenciais coerentes, e host da API em allowlist de TEST. Esse allowlist permanece vazio; não é possível apontar um job TEST para a API publicada sem revisão explícita do código.
- Não foram configuradas integrações externas. A confirmação de desativação no Dashboard Auth/Vercel ainda é responsabilidade operacional antes de qualquer escrita; uma flag de ambiente, sozinha, não prova configuração do plano de controle.

## Execução depois da autorização

1. Preencha `.env.test.local` com credenciais do projeto TEST e confirme no Dashboard ref, domínio Auth/Storage e host/usuário PostgreSQL. Preencha o env da web com somente URL, chave anônima e API local.
2. Configure o projeto Supabase TEST sem dados reais: signup público desativado, redirects apenas locais, sem SMTP de produção, webhooks, cobrança ou VAPID. Crie os três buckets privados com limites e policies da aplicação.
3. Faça dry-run/inspeção da sequência de migrations e valide extensões. Só aplique no TEST após autorização explícita da ref; então confira todos os objetos SQL e compare o estado final ao Prisma.
4. Execute preflight com valores carregados sem os imprimir: `node --env-file=.env.test.local --import tsx tools/qa/verify-workflows.ts --preflight`. Confirme ref/hosts, ambas as conexões DB, buckets, RLS e status `writeAuthorized=false` até revisão.
5. Após comparação humana de Production/Preview, habilitação dos controles de saída e aprovação da ref, um revisor pode adicionar a ref TEST à allowlist QA e, se houver scheduler, o host API TEST à allowlist correspondente. Só então defina `QA_ALLOW_WRITES=true` e rode a API local com `--local-api`.
6. Verifique progressivamente Auth sintética, membership, clientes, Storage, processos, financeiro, documentos, agenda e portal. Use tokens de cada papel, dados sintéticos com prefixo aleatório e preserve artefato por jornada. Confirme a limpeza: organizações próprias arquivadas, memberships suspensas, identidades banidas; histórico/objetos sintéticos retidos somente conforme política documentada.

Cada autorização acima é para o projeto TEST identificado. Não aplique essas variáveis ou migrations a Production/Preview e não faça deploy nesta fase.
