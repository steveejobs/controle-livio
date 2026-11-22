# Lívio

CRM jurídico e controle financeiro multiempresa. Supabase concentra Database, Auth e Storage; a API aplica autorização, regras de negócio e auditoria. Prisma é o ORM, e as migrations operacionais ficam no Supabase.

## Requisitos

- Node.js >=24.15 <25; versão validada 24.22.3.
- npm >=10; instale a árvore exata com `npm ci`.
- Docker e Supabase CLI para executar a stack local isolada.

No Windows, [o helper de runtime](tools/runtime/README.md) permite usar o Node portátil sem alterar a instalação global.

## Estrutura

```text
apps/
  api/          API NestJS
  web/          Aplicação Next.js
packages/
  db/           Prisma, adaptador e pool PostgreSQL
  shared/       Contratos, validações e regras puras
  ui/           Componentes compartilhados
supabase/       Configuração local e migrations versionadas
tools/          Ferramentas agrupadas por domínio
docs/           Documentação técnica e operacional atual
```

## Desenvolvimento

```powershell
npm ci
npm run supabase:start
npm run supabase:status
```

Prepare `.env` a partir de `.env.example`, usando exclusivamente credenciais da stack local. Configure o banco conforme [a arquitetura Supabase](docs/SUPABASE_ARCHITECTURE.md), respeitando as confirmações de destino e as regras do repositório. Depois:

```powershell
npm run dev
```

Web: `http://localhost:3000`. API: `http://localhost:3001/v1`. OpenAPI: `http://localhost:3001/v1/docs`.

Não reutilize credenciais locais em produção. Reset e seed não fazem parte da publicação e não devem ser executados em banco compartilhado.

## Qualidade

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run db:validate
npm run build
```

A CI também valida navegador, Auth/RLS/Storage, concorrência financeira, scanner, captura local de email e recuperação em infraestrutura descartável. Resultados anteriores e limites estão na [homologação atual](docs/HOMOLOGACAO_2026_11_22.md).

## Documentação e operação

Comece pelo [índice técnico](docs/README.md). O roteiro de publicação está em [DEPLOYMENT.md](docs/DEPLOYMENT.md); organização, decisões e pendências atuais estão em [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md).

Relatórios gerados, capturas e traces não pertencem ao código. Ferramentas devem gravá-los em `test-results/` ou em uma pasta privada explicitamente escolhida; esses materiais ficam fora do Git e do upload Vercel.
