# ADR 0003: Isolamento multiempresa explícito

- Status: aceito
- Data: 2026-08-07

## Contexto

Uma falha de filtro pode expor dados jurídicos entre escritórios e representa o maior risco sistêmico.

## Decisão

Todas as tabelas de negócio carregam `organization_id`; identidades naturais são únicas dentro dele. Token e sessão precisam concordar sobre tenant. A API usa contexto assíncrono e `OrganizationScope`; rotas são negadas sem permissão. RLS será uma camada adicional antes de produção.

## Consequências

Consultas e índices são mais explícitos, e testes de tenant tornam-se obrigatórios. Jobs precisam estabelecer um contexto confiável por organização. A tabela raiz `organizations` não possui auto-referência.
