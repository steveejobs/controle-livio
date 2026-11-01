# Plano separado: migração Prisma 6 para 7

**Estado em 2026-10-30: planejada, não iniciada.** Nenhuma dependência ou migration de banco foi alterada por esta etapa.

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
