# Ambientes

| Ambiente      | Dados                                         | Operações permitidas                       |
| ------------- | --------------------------------------------- | ------------------------------------------ |
| `local`       | Supabase CLI/Docker, exclusivamente fictícios | reset, seed, RLS/E2E                       |
| `development` | projeto DEV separado ou stack local           | migrations após validação; sem dados reais |
| `staging`     | projeto isolado semelhante à produção         | migrations, smoke/E2E não destrutivo       |
| `production`  | projeto exclusivo com dados reais             | deploy aprovado; nunca reset/seed/E2E      |

`SUPABASE_ENVIRONMENT` informa `development`, `test`, `staging` ou `production` e
`SUPABASE_LOCAL=true` distingue a stack CLI. URL do Database, URL Supabase e project ref precisam ser
coerentes; a API falha no startup sem configuração obrigatória.

## Estado do projeto cloud configurado

Em 2026-10-20, o ambiente remoto de desenvolvimento/homologação foi substituído por um projeto novo e
vazio. As cinco migrations oficiais foram aplicadas pela Supabase CLI; há 39 tabelas públicas com RLS
habilitada e forçada, 141 policies e o bucket privado `legal-documents`. A organização `bandeira` e a
membership administrativa foram provisionadas no novo Auth. A API e a web da Vercel usam somente as
credenciais do projeto novo nos ambientes Production e Preview. O deploy da API usa
`SUPABASE_ENVIRONMENT=staging`, pois o runtime `NODE_ENV=production` exige essa classificação.
Signup público está desabilitado, senha mínima é 12 caracteres e Site URL/redirects apontam para a
web publicada. Custom SMTP e a entrega efetiva do convite administrativo ainda precisam de validação.

## Safeguards

- Reset/seed: apenas local, `development/test`, URL local.
- Migration remota: project ref e confirmação iguais; produção exige autorização adicional.
- Bootstrap remoto: `ALLOW_REMOTE_BOOTSTRAP=true`; produção exige também
  `ALLOW_PRODUCTION_BOOTSTRAP=true`.
- Prisma Studio: bloqueado em produção.
- Teste RLS: aborta se Supabase URL não for localhost/127.0.0.1.

Segredos ficam no secret manager/plataforma de deploy. `.env.example` contém apenas placeholders e
separa `NEXT_PUBLIC_SUPABASE_*` de credenciais server-side. Service role e senha de bootstrap nunca
podem ser expostas no navegador.

## SMTP

Local usa Inbucket. Staging/produção devem configurar custom SMTP no Supabase Auth, remetente validado,
SPF/DKIM/DMARC, rate limits, templates e redirects por ambiente. Recuperação deve ser verificada em
staging antes da produção.

## Backup e restauração

Database e Storage têm planos independentes. Restaurar sempre em projeto isolado, conferir migrations,
Auth, memberships, RLS, constraints/tenant triggers, contagens por organização e integridade dos
objetos. Somente depois promover por change aprovado; nunca restaurar diretamente sobre produção.
