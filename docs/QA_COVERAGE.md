# Qualidade e cobertura

A aprovação descreve versão, ambiente e casos executados. Quantidade de testes não equivale a percentual de cobertura funcional nem a ausência universal de defeitos.

## Verificações obrigatórias

```text
npm run format:check
npm run lint
npm run typecheck
npm test
npm run db:validate
npm run build
```

`npm test` executa os testes dos workspaces. Os testes Node das ferramentas são executados separadamente e após gerar/compilar seus pré-requisitos. No Windows, usar o runtime portátil e os comandos de [tools/qa](../tools/qa/README.md).

## Camadas

| Camada                     | Verifica                                                  | Limite                                                  |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Unitários                  | Regras, serviços, permissões, componentes e helpers       | Dependências externas podem ser simuladas               |
| Navegador com API simulada | Formulários, navegação, responsividade e estados de erro  | Não comprova persistência real                          |
| Integrado descartável      | Auth, API, PostgreSQL, RLS, Storage, scanner e navegador  | Não comprova a infraestrutura hospedada                 |
| Financeiro real            | Decimal, concorrência, idempotência, auditoria e rollback | A carga sintética não representa todos os escritórios   |
| Recuperação                | Destino independente, SQL/Auth/arquivos e retomada        | Segredos e configuração hospedada são escopos separados |
| Homologação da publicação  | Serviço implantado, configuração e fluxos reais           | Precisa ocorrer após o deploy da candidata              |

## Última candidata funcional comprovada

491 testes Vitest, 208 Node, 42 testes de interface simulada e 17 jornadas integradas. Financeiro 312/312, identidade/operação 43/43, escopo de cliente 10/10 e recuperação 58/58 aprovados. O subconjunto focused de seis testes repete jornadas e não acrescenta seis casos únicos.

Storage: 64 requisições aprovadas; oito células planejadas não executadas. Scanner real e captura local de email aprovados. Fontes e execuções estão na [homologação](HOMOLOGACAO_2026_11_22.md).

## Segurança da execução

Os runners integrados exigem infraestrutura descartável, endpoints locais e ausência de credenciais compartilhadas. Não executar os runners de escrita com o `.env` persistente. Alguns scripts históricos com nomes de leitura também criam sessões Auth; leia o escopo antes de executar.

Novos resultados devem ficar em `test-results/` ou pasta privada. Não versionar capturas, traces, relatórios brutos ou dumps. Preserve somente a síntese necessária para reproduzir e avaliar a validação.
