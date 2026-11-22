# Plano separado: migração Prisma 6 para 7

**Estado em 2026-11-22: implementação em candidata local, homologação completa pendente.**

Implementados Prisma 7.10.1 e adapter-pg, geração CJS, configuração explícita do CLI,
pool limitado, métricas pg e migração dos consumidores para `@livio/db`.
Node portátil 24.22.3 permite atualizar CLI Nest sem substituir o runtime global.
Nenhuma migration foi aplicada ao Supabase compartilhado.

O override major de Deepmerge foi evitado. A versão 7.10.1 ainda fixa Effect 3.20.0;
aplicado override restrito para 3.22.1 na mesma linha 3.x, após conferir o
[advisory e a correção upstream](https://github.com/Effect-TS/effect/security/advisories/GHSA-7589-6fvf-x4pw).
`npm update effect` foi necessário para atualizar efetivamente o lockfile/instalação;
`npm ls` identificou e rejeitou a árvore intermediária inválida. Audit reportou zero
vulnerabilidades após a atualização real. Não há aceite silencioso dos alertas anteriores.

`relationJoins` foi desativado: a prova nativa reproduziu perda de precisão em Decimal
de relação com 19 dígitos. Consultas padrão separadas conservaram o valor exato. Essa
decisão prioriza integridade financeira; exige medição de latência/pool na homologação.

`tools/database/verify-prisma-adapter.mjs` cria PostgreSQL 17.12 exclusivo com dados
sintéticos e conserva seu diretório após desligar o servidor. Testa SQL/adaptador e
serviços, sem atribuir aprovação a Auth/RLS/Storage ou recuperação hospedada.
As evidências e os gates finais ficam registrados em `PROJECT_CONTEXT.md`.

Uma consulta somente leitura ao Supavisor configurado confirmou a necessidade de CA
explícita no driver Node. O pacote inclui os certificados públicos de produção 2021/2025
da [fonte oficial Supabase CLI, revisão fixa](https://github.com/supabase/cli/tree/3adfdd50577b6508f54688104601e5da8215a6c3/apps/cli/src/command-internal/supabase-ca-templates).
Eles ampliam as raízes padrão somente para hosts oficiais DB/pooler. Certificado e
hostname continuam validados; sem `rejectUnauthorized=false`, leitura de chave privada
ou mudança no TLS do projeto. A [documentação oficial de SSL](https://supabase.com/docs/guides/platform/ssl-enforcement)
orienta fornecer a CA ao cliente. A prova de conexão com Prisma 7 passou sem escrita
ou consulta a dados de negócio; não equivale a homologação autenticada completa hospedada.

Os itens abaixo preservam o plano e a evidência histórica de 2026-10-30.

## Evidência de dependências

- O lockfile instala Prisma Client e CLI `6.19.3`; a última versão publicada na linha 6 consultada no npm é `6.19.3`.
- `npm audit --omit=dev` retorna três alertas altos na cadeia `prisma@6.19.3` → `@prisma/config` → `deepmerge-ts@7.1.5` (GHSA-ggr8-5vv4-36mx).
- O audit recomenda `prisma@7.10.1`, que é uma mudança major. A configuração publicada do Prisma `7.10.1` usa `deepmerge-ts@8.0.2`; a configuração `6.19.3` fixa `7.1.5`.
- Não foi encontrada atualização compatível na linha Prisma 6. Não será aplicado override: a dependência é exata no Prisma Config e a árvore precisa permanecer coerente.

## Mudanças técnicas previstas

1. Atualizar `prisma` e `@prisma/client` em conjunto e adicionar `@prisma/adapter-pg`/`pg` nas workspaces corretas.
2. Mover conexão e configuração do CLI do `datasource` do schema para `prisma.config.ts`; confirmar carregamento explícito das variáveis, pois o CLI v7 não carrega `.env` automaticamente.
3. Migrar o gerador `prisma-client-js` para `prisma-client` com saída explícita dentro de `packages/db`, ajustar exports e imports e manter artefatos gerados fora do Git.
4. Avaliar a fronteira ESM: o Prisma 7 usa módulos ES e o monorepo/Nest atual compila a API como CommonJS. Definir a configuração de TypeScript e build da API sem converter workspaces por acidente.
5. Instanciar `PrismaClient` com `PrismaPg`. Definir explicitamente tamanho do pool, timeout de conexão, timeout ocioso e encerramento no ciclo NestJS; os padrões do `pg` diferem dos padrões Prisma 6.
6. Substituir a leitura de `Prisma.$metrics`, removida no Prisma 7, pelas métricas suportadas pelo adapter/pool. Preservar logs sanitizados, contagem de consultas e medidas de espera.
7. Validar Supavisor em modo transacional, conexões curtas da Vercel, transações interativas e estado de sessão usado por Auth/RLS. Não mudar o executor de migrations: `supabase/migrations` continua sendo o único histórico ativo.

## Gates obrigatórios em destino descartável

- `prisma generate`, `prisma validate`, TypeScript e builds limpos de todas as workspaces.
- Suíte Vitest completa e consultas financeiras com Decimal/string, idempotência, alocação, pagamentos parciais, quitação e reversões.
- Auth, tenant/RLS, Storage e jornadas integradas em Supabase local; verificar políticas com transação e pool de conexões real.
- Medir P2024, pool p50/p95, conexões abertas/aguardando, consultas, duração de API e bundle antes/depois.
- `npm audit --omit=dev` e `npm audit` após atualizar o lockfile. Só considerar a cadeia resolvida se a árvore instalada confirmar a versão segura, sem override.

Uma execução em branch isolada e CI temporário deve preceder qualquer promoção. Este plano não autoriza migration no Supabase compartilhado nem deploy.

Referências: [guia oficial de atualização Prisma 7](https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v7), [Prisma Client 7.10.1](https://www.npmjs.com/package/@prisma/client?activeTab=versions) e [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx).
