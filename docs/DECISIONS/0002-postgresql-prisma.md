# ADR 0002: PostgreSQL e Prisma

- Status: aceito
- Data: 2026-08-07

## Contexto

O domínio requer transações, integridade referencial, precisão decimal, índices compostos e evolução controlada. Não havia banco configurado no repositório.

## Decisão

Usar PostgreSQL como fonte de verdade e Prisma como schema/client. IDs são UUID, tempo usa `timestamptz`, dinheiro usa Decimal. Migrations são SQL versionado e nunca aplicadas automaticamente pela inicialização da aplicação.

## Consequências

O domínio ganha consistência e tipagem. Checks/invariantes avançados precisam de SQL manual revisado. O Compose é apenas uma alternativa local e não substitui banco fornecido. A migration inicial foi produzida offline.
