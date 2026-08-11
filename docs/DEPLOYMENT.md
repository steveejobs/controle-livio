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
- `DATABASE_URL` com SSL e pooler apropriado;
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
