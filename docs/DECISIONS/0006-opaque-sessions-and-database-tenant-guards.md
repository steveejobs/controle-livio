# ADR 0006 — Sessões opacas e barreira de tenant no banco

- Status: aceito
- Data: 2026-08-07

## Contexto

O CRM contém dados jurídicos e financeiros de múltiplos escritórios. Um token autoportante dificulta revogação imediata; filtros somente na aplicação deixam uma única omissão expor outro tenant.

## Decisão

Usar sessão aleatória opaca em cookie HttpOnly, persistindo somente seu hash. Associar CSRF, validade e revogação à sessão. Derivar `organizationId` da sessão e aplicar RBAC granular com negação por padrão.

No PostgreSQL, manter `organization_id` em todas as entidades de negócio e criar triggers que verificam a organização de cada referência. Históricos e identidade financeira confirmada são protegidos por triggers de imutabilidade.

## Consequências

Revogação é imediata e cada requisição autenticada consulta o banco, custo aceito nesta fase. As triggers são SQL manual não representado integralmente pelo Prisma; toda migration futura deve preservar e testar essas funções. RLS continua sendo uma defesa adicional planejada, não substituta das três camadas atuais.
