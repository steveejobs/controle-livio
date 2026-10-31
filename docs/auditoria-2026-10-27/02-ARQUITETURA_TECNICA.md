# Arquitetura técnica

**Data da auditoria:** 2026-10-27. Evidência principal: checkout e dependências instaladas localmente.

## Stack e versões observadas

| Área                     | Tecnologia                                                      |
| ------------------------ | --------------------------------------------------------------- |
| Linguagem                | TypeScript estrito; Node.js >=22, npm >=10 exigidos             |
| Gerenciador              | npm workspaces; packageManager npm@11.17.0                      |
| API                      | NestJS 11, Express, Zod, Swagger, Pino                          |
| Web                      | Next.js 16, React 19                                            |
| Dados                    | PostgreSQL via Supabase; Prisma 6; Supabase JS                  |
| Domínio                  | Decimal.js; valores monetários serializados como string/Decimal |
| Documentos               | docx e pdf-lib; assinatura rasterizada em PDF                   |
| OCR                      | Tesseract.js e modelo português distribuídos localmente         |
| Testes                   | Vitest 3; Playwright                                            |
| Infraestrutura observada | Vercel, Supabase Auth/Database/Storage, pg_cron, pg_net, Vault  |

Versões resolvidas observadas no checkout: Node 24.12.0, npm 11.17.0, Nest 11.1.28 (platform-express 11.2.7), Swagger 11.4.6, Supabase JS 2.112.2, Prisma/client 6.19.3, Next 16.4.2, React 19.2.8, Zod 4.4.3, Decimal.js 10.6.0, docx 9.13.0, pdf-lib 1.17.1, Tesseract.js 7.0.0 e Vitest 3.2.7. O lockfile é a fonte reproduzível; versões podem mudar fora deste checkout.

## Workspaces e limites

| Caminho             | Responsabilidade                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| apps/api            | API modular NestJS; autenticação, autorização, regras, persistência, arquivos, relatórios, alertas |
| apps/web            | Next.js; entrada, recuperação, assinatura pública e aplicação React com módulos em uma shell       |
| packages/db         | Prisma Client, schema PostgreSQL, utilitários de banco; migrações Prisma antigas estão arquivadas  |
| packages/shared     | Tipos, contratos, schemas, permissões e parsing de configuração compartilhados                     |
| packages/ui         | Elementos reutilizáveis de interface                                                               |
| supabase/migrations | Histórico SQL atual para schema, RLS, grants, buckets e automações                                 |
| tools               | Bootstrap, inspeção, migração protegida, QA, scheduler, bundle, medição e imagem                   |
| docs                | Arquitetura, produto, segurança, operações e histórico; há material legado                         |

Limites arquiteturais a preservar: regras e persistência no backend; organização autenticada e permissão explícita nas operações privadas; isolamento por organization_id; valores de dinheiro Decimal/string; schemas compartilhados; componentes de domínio pequenos e acessíveis; tokens/motion em apps/web/theme.

## API

apps/api/src/app.module.ts registra módulos funcionais e guards/interceptor globais: AuthenticationGuard, RequestRateLimitGuard, PermissionGuard e TenantContextInterceptor. A API usa prefixo /v1, Helmet, CORS por allowlist, validação global, filtro de erro, Pino e OpenAPI em /v1/docs e /v1/docs/openapi.json.

Módulos Nest de negócio identificados: auth, admin, audit, health, dashboard, clients, matters, finance, documents, work, notifications e reports. prisma fornece infraestrutura de persistência. São 12 módulos de domínio mais o módulo de banco. O catálogo de operações está em 06-APIS_E_INTEGRACOES.md.

## Web e navegação

Há três páginas Next: /, /reset-password e /assinar/[token]; /auth/confirm é um route handler de callback. A aplicação principal tem 16 áreas apresentadas como tabs/estado local dentro da shell, sem URL própria para cada módulo. Também há manifest e service worker estático para PWA/push. Isso facilita a navegação da sessão atual, mas não oferece deep link/refresh independente de cada módulo.

## Dados

Prisma contém 45 models e 25 enums. O diretório supabase/migrations possui 16 arquivos SQL, de fundação a fotos e assinatura. As migrações Prisma em packages/db/prisma/migrations estão marcadas como arquivadas; não se deve tratá-las como fonte atual de aplicação de schema. Não foi feito acesso ao banco remoto; veja 05-BANCO_DE_DADOS.md.

## Execução e configuração

As configurações de ambiente são validadas por parseApiEnvironment/parseWebEnvironment no pacote compartilhado. Arquivos .env podem ser carregados em dev/build/test; seus valores foram deliberadamente excluídos desta auditoria. Nomes relevantes, sem valores: NEXT_PUBLIC_API_URL, SUPABASE_URL, SUPABASE_ANON_KEY, DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CORS_ORIGINS, CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e SMTP_*.

O usuário e a organização inicial dependem de provisionamento administrativo/CLI; cadastro público está desativado. apps/api/vercel.json e apps/web/vercel.json configuram implantação/cron Vercel; o código em tools/notifications/configure-scheduler.mjs descreve scheduler separado por pg_cron/pg_net/Vault. Configuração remota atual não foi consultada.

## Dependências e serviços

Dependências externas incluem Supabase Auth, PostgreSQL, Storage, Vercel, browser Push API/web-push e Speed Insights. WhatsApp e e-mail são entregues ao aplicativo do usuário por links predefinidos, não por integração de envio automático. OCR é executado localmente no navegador com worker/WASM/idioma empacotados.

## Ferramentas e CI

Workflows em .github/workflows cobrem qualidade de aplicação e isolamento com Supabase local/Docker. tools/ inclui inspeção remota somente leitura, migração com salvaguardas, QA somente leitura, provisionamento protegido e ferramentas que podem criar dados artificiais. Antes de executar scripts, verificar seus modos e opções: alguns comandos são explicitamente mutáveis. Esta auditoria não executou ferramentas de provisionamento, migration ou QA que escreva dados.

## Divergências documentais

- README.md ainda descreve quatro migrações; existem 16 SQL no checkout.
- docs/API.md tem caminhos antigos (por exemplo, prefixo de auditoria diferente) e não descreve por completo fotos/assinatura.
- docs de arquitetura/dados refletem schema anterior às migrações de alertas, fotos e assinatura.
- PROJECT_CONTEXT.md é mais recente, mas seu histórico de banco publicado não foi revalidado contra a infraestrutura.

## Código antigo e desconectado

Há um protótipo de dashboard em apps/web/features/dashboard/page.tsx com números/estado estáticos e um componente SystemHealth. A árvore de importações da shell ativa não usa essa página; o dashboard ativo usa a API. Classificação: LEGADO provável, com evidência de ausência de consumidor no fluxo ativo, não remoção autorizada.
