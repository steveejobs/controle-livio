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

Em 2026-08-11, o projeto Supabase remoto informado no ambiente contém as quatro migrations oficiais,
um usuário Auth confirmado e a organização `bandeira` com membership administrativa. Permanece sem
objetos de Storage ou seed remoto. Signup público foi desabilitado e a senha mínima foi elevada para
12 caracteres, mas Site URL, redirects e SMTP ainda dependem do domínio/remetente finais. O ambiente
precisa ser classificado explicitamente no deploy; esse provisionamento não o torna automaticamente
produção.

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
