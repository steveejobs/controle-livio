# Agendamento e push em homologação

Estes comandos alteram configuração cloud: `provision-runtime.mjs` grava segredos no Vercel Production; `configure-scheduler.mjs` grava no Vault Supabase e `--activate` agenda `pg_cron`. Execute somente em mudança operacional explicitamente aprovada. O provisionador aceita apenas a ref Production verificada; nunca o use com env TEST.

1. `node --env-file=.env tools/notifications/provision-runtime.mjs --apply --confirm-project=<ref>` cria `CRON_SECRET` e chaves VAPID, grava uma cópia local ignorada pelo Git e configura as variáveis sensíveis no projeto Vercel da API. Execute uma única vez; guarde a cópia local com segurança.
2. `node --env-file=.env tools/notifications/configure-scheduler.mjs --runtime-env=apps/api/.env.scheduler-generated.local --api-url=https://<api>/v1 --apply --confirm-project=<ref>` grava URL e segredo no Vault, sem ativar o job.
3. Após publicar e verificar a API, repita o comando anterior com `--activate`. O comando prova a assinatura contra a rota publicada antes de agendar `pg_cron` a cada minuto.
4. Sem `--apply`, `configure-scheduler.mjs` apenas mostra se existe um job ativo e confirma que os papéis de navegador não leem o Vault.

O `pg_net` armazena cabeçalhos em fila legível por papéis gerenciados da plataforma. Por isso a fila recebe apenas HMAC expirada e protegida contra replay; nunca recebe `CRON_SECRET` diretamente. Push exige permissão e inscrição do usuário no dispositivo; a tela de notificações oferece um envio de teste.

`provision-runtime.mjs` grava no Vercel Production e agora só aceita a ref Production verificada; nunca o execute com configuração TEST. Para `SUPABASE_ENVIRONMENT=test`, `configure-scheduler.mjs` exige uma ref distinta, URLs/credenciais coerentes e host de API TEST em allowlist versionada. Essa allowlist está vazia; mantenha jobs TEST desativados até haver endpoint não produtivo aprovado.
