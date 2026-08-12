# Segurança

## Autenticação

Supabase Auth é o único autenticador. Next.js usa `@supabase/ssr` para refresh e cookies seguros; a API
recebe access token por `Authorization: Bearer` e valida com a chave anon/pública. Login, convite,
logout e recuperação não passam por tabelas de senha próprias. Redirects são limitados por ambiente.

As tabelas legadas `sessions` e `password_reset_tokens` permanecem inativas apenas para preservar o
histórico de schema. `users.password_hash` é nullable e a migration definitiva limpa hashes depois de
confirmar que toda conta ativa possui `auth_user_id`.

## Autorização

O tenant vem de `organization_members`, nunca do body/query. A proteção combina:

1. RLS baseada em `auth.uid()`, membership e permissões;
2. guardas NestJS com negação por padrão e `RequirePermission`;
3. filtros explícitos por `organizationId` nos serviços;
4. triggers que impedem FKs cruzadas entre organizações.

Papéis de sistema: administrador, advogado, secretaria, financeiro e cliente. O código usa permissões
centralizadas `recurso:ação`; não depende de `if role === admin` espalhado.

O papel PostgreSQL `authenticated` recebe somente `SELECT`, `INSERT`, `UPDATE` e `DELETE` nas tabelas
públicas. Isso permite que a requisição alcance o RLS, que continua negando por tenant, cliente e
permissão; o papel não recebe `TRUNCATE`, `REFERENCES`, `TRIGGER` nem privilégios administrativos.

## Service role

`SUPABASE_SERVICE_ROLE_KEY` é obrigatória somente no servidor para Storage administrativo, convites e
bootstrap. Nunca aparece em variável `NEXT_PUBLIC_`, resposta, HTML, bundle ou log. A API não usa essa
chave para autorizar regras financeiras nem para aceitar tenant enviado pelo cliente.

## Documentos

Bucket privado, signed URLs curtas e metadata sem URL pública. Upload pela API valida tamanho, MIME,
assinatura mágica, nome sanitizado, organização e vínculos. Extensão/Content-Type do navegador não são
suficientes. Varredura antimalware assíncrona continua um requisito explícito antes de produção; o
sistema não declara arquivos como seguros sem scanner.

## Operação

Produção exige TLS, CORS explícito, custom SMTP, rotação de chaves, rate limit distribuído, logs/alertas,
backup restaurável do Database e política separada para Storage. Seeds, resets e testes RLS são
bloqueados em produção. Bootstrap e migration remotos exigem confirmações independentes.
