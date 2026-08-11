# Arquitetura

## Visão geral

O Lívio é um monólito modular em monorepo TypeScript estrito. Supabase é a única plataforma persistente. `apps/web` contém o Next.js, `apps/api` contém o NestJS, `packages/db` concentra o schema Prisma do Database Supabase, `packages/shared` mantém contratos e regras puras, `packages/ui` fornece primitivas visuais e `tools` reúne utilitários isolados.

Os módulos da API são `auth`, `admin`, `clients`, `matters`, `finance`, `documents`, `work`, `reports`, `audit`, `dashboard` e `health`. Cada módulo declara controllers, schemas Zod, serviço de domínio e políticas. A API orquestra transações; o Prisma é a única porta de persistência.

## Fluxo de requisição

1. Helmet e CORS restringem a superfície HTTP; o proxy só é confiado quando configurado.
2. A guarda valida o Bearer JWT no Supabase Auth.
3. Profile, membership ativa, usuário operacional e organização são validados em conjunto.
4. Papéis e permissões são carregados da membership selecionada.
5. O tenant solicitado só é aceito quando existe membership ativa correspondente.
6. Rotas privadas sem `RequirePermission` são negadas.
7. O interceptor propaga o ator autenticado; serviços sempre compõem `organizationId` do ator.
8. Erros retornam um formato único e `requestId`; logs estruturados redigem authorization e cookies.

O navegador jamais escolhe o tenant. Campos `organizationId` recebidos por body/query não fazem parte dos DTOs de negócio.

## Persistência e consistência

O Database PostgreSQL do projeto Supabase é a única fonte de verdade. Operações financeiras e movimentos de etapa usam transações `SERIALIZABLE`, locks de linha em ordem estável, versão otimista e retry limitado para conflito `P2034`. Auditoria é escrita pelo mesmo transaction client.

A migration adiciona checks de domínio, foreign keys restritivas, uma barreira de tenant no banco para referências entre tabelas e triggers append-only. A migration inicial é atômica (`BEGIN`/`COMMIT`) e não contém remoção de dados.

Documentos ficam em bucket Supabase privado. O banco guarda somente metadados, chave opaca, tamanho, MIME e SHA-256. Upload e persistência usam compensação: se a transação falhar, o objeto recém-enviado é removido.

## Configuração, documentação e escala

O ambiente é validado por Zod no boot. A API expõe liveness e readiness; readiness executa apenas `SELECT 1`. OpenAPI é gerado em `/v1/docs` e `/v1/docs/openapi.json`.

API e web não mantêm sessão em memória e podem escalar horizontalmente. Jobs futuros devem usar outbox transacional. Rate limit distribuído, antivírus assíncrono e telemetria continuam planejados. RLS e policies Supabase são versionados em `supabase/migrations`; veja `SUPABASE_ARCHITECTURE.md`.

Na web, tema e motion permanecem centralizados em `apps/web/theme`; esta etapa não acopla domínio do backend ao frontend.
