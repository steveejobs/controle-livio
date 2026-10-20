# Verificação QA no ambiente remoto

`live-readonly.mjs` consulta somente a organização QA existente. Ele usa a service role apenas para
gerar um token de acesso temporário do administrador sintético; não imprime tokens nem altera registros
de negócio. A execução exige `SUPABASE_ENVIRONMENT=development/test`, projeto correspondente à URL,
organização com prefixo `qa-` e API HTTPS.

No PowerShell, depois de carregar `.env` no processo, defina `QA_PROJECT_REF`, `QA_ORG_SLUG` e
`QA_API_URL` (URL HTTPS da API de homologação, terminando em `/v1`). Execute:

```text
node --env-file=.env tools/qa/live-readonly.mjs
```

A ferramenta falha antes de consultar a API quando as confirmações não correspondem ao projeto. Não
teste com organização real. A obtenção do token usa Supabase Auth, mas não verifica entrega de e-mail.
