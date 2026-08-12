# Publicação

Web, API e Supabase são publicados como três limites distintos. O repositório não pressupõe um
provedor específico; qualquer plataforma escolhida precisa oferecer Node.js 22+, HTTPS, variáveis
secretas, health check e logs persistentes.

## Ordem de publicação

1. Reserve o domínio HTTPS da API, por exemplo `https://api.seudominio.com`, e publique a API.
2. Configure o build da web com `NEXT_PUBLIC_API_URL=https://api.seudominio.com/v1` e publique a web.
3. No Supabase Auth, configure a Site URL da web e permita somente redirects necessários, incluindo
   `https://app.seudominio.com/auth/confirm`.
4. Configure custom SMTP, SPF/DKIM/DMARC, desabilite signup público quando o acesso for por convite e
   mantenha senha mínima de pelo menos 12 caracteres.
5. Aponte DNS, valide certificados e só então execute os smoke tests finais.

Não reutilize `.env` local no provedor. Cada valor deve ser cadastrado no secret manager do ambiente.

## Serviço API

Comandos:

```text
npm ci
npm run build:packages
npm run build -w @livio/api
npm run start -w @livio/api
```

Variáveis obrigatórias:

- `NODE_ENV=production`;
- `API_PORT` ou `PORT`, conforme a porta fornecida pela plataforma;
- `DATABASE_URL` com SSL; em Vercel/serverless, use o Transaction pooler do Supabase (Supavisor,
  porta `6543`) com `pgbouncer=true&connection_limit=1`, nunca o endpoint direto IPv6;
- `SUPABASE_ENVIRONMENT=staging` ou `production`;
- `SUPABASE_PROJECT_REF` e `CONFIRM_SUPABASE_PROJECT_REF` iguais;
- `SUPABASE_LOCAL=false`;
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`;
- `SUPABASE_AUTH_REDIRECT_URL` HTTPS;
- `CORS_ORIGINS` com a origem HTTPS exata da web, sem wildcard;
- `STORAGE_BUCKET=legal-documents`, `MAX_DOCUMENT_SIZE_MB` e `LOG_LEVEL`;
- `TRUST_PROXY=true` somente quando a topologia do provedor possui um proxy confiável compatível.

O health check deve usar `/v1/health/ready`; `/v1/health/live` prova somente o processo.

## Serviço web

Comandos:

```text
npm ci
npm run build:packages
npm run build -w @livio/web
npm run start -w @livio/web
```

Variáveis de build obrigatórias:

- `NEXT_PUBLIC_API_URL`, incluindo `/v1`;
- `NEXT_PUBLIC_SUPABASE_URL`;
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Esses três valores são públicos por definição e ficam no bundle. Service role, conexão PostgreSQL e
tokens de infraestrutura nunca pertencem ao serviço web.

### Vercel

Crie dois projetos Vercel ligados ao mesmo repositório. Para a web:

- Framework Preset: `Next.js`;
- Root Directory: `apps/web`;
- Include source files outside of the Root Directory: habilitado;
- Build e Install Command: mantenha os valores detectados de `apps/web/vercel.json`;
- Output Directory: padrão do Next.js (`.next`).

A web usa o adaptador nativo Next.js da Vercel e declara a raiz do monorepo para output tracing; não
force `output: standalone`, que é destinado ao empacotamento de self-host/Docker.

Para a API:

- Framework Preset: `NestJS`;
- Root Directory: `apps/api`;
- Include source files outside of the Root Directory: habilitado;
- Build e Install Command: mantenha os valores de `apps/api/vercel.json`;
- Output Directory: vazio, para o preset NestJS produzir uma única Vercel Function;
- Fluid compute: habilitado.

Enquanto os aliases `vercel.app` forem usados, `controle-livio.vercel.app` identifica o projeto da
API e `controle-livio-web.vercel.app` identifica a web. A raiz `/` da API possui redirecionamento
temporário versionado para a web; rotas `/v1/*` continuam atendidas diretamente pela API. Domínios
próprios futuros devem manter os limites `api.*` e `app.*` e substituir esse redirecionamento.

Os comandos de instalação versionados usam `npm ci --include=dev`: `NODE_ENV=production` não pode
remover `typescript`/CLI de build antes da compilação. Arquivos `.env*`, `chaves` e metadados locais
da Vercel são excluídos do upload por `.vercelignore`; configure os valores somente no projeto Vercel.

O projeto da API precisa receber todas as variáveis server-side listadas acima. Nele,
`CORS_ORIGINS` recebe a URL HTTPS da web e `SUPABASE_AUTH_REDIRECT_URL` recebe essa URL seguida de
`/auth/confirm`. Depois do primeiro deploy da API, use a URL HTTPS dela na variável
`NEXT_PUBLIC_API_URL` do projeto web, acrescentando `/v1`. Não selecione `apps/api` no projeto web nem
`apps/web` no projeto API.

## Gate de promoção

Antes de promover staging para produção:

```text
npm run format:check
npm run lint
npm run typecheck
npm test
npm run db:validate
npm run build
```

O workflow `Quality` também sobe Supabase descartável e executa `test:supabase`. Em staging, valide
login, refresh, recuperação de senha, troca de organização, CRUD essencial, exportação CSV, upload e
download de documentos, isolamento entre organizações e layout a 360 px.

Não publique enquanto scanner antimalware, rate limit distribuído, telemetria/alertas, custom SMTP e
ensaio de restauração ainda forem requisitos pendentes para o uso real pretendido.
