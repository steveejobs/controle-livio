# ADR 0001: Monorepo e monólito modular

- Status: aceito
- Data: 2026-08-07

## Contexto

O repositório estava vazio e o produto precisa compartilhar contratos entre web, API, persistência e UI, mantendo deploys distinguíveis.

## Decisão

Usar npm workspaces, Next.js em `apps/web`, NestJS em `apps/api` e pacotes explícitos para banco, contratos e UI. A API começa como monólito modular sem estado em memória.

## Consequências

Instalação e CI têm um lockfile; mudanças transversais são atômicas. O build respeita ordem entre pacotes. Extração futura exige preservar limites de domínio, mas não exige infraestrutura distribuída agora. Nenhuma tecnologia existente foi substituída, pois não havia base instalada.
