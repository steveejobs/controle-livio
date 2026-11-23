# Documentação

## Produto e implementação

| Documento                            | Conteúdo                                  |
| ------------------------------------ | ----------------------------------------- |
| [Especificação](PRODUCT_SPEC.md)     | Escopo funcional e regras do produto      |
| [Arquitetura](ARCHITECTURE.md)       | Módulos, limites e fluxo de requisições   |
| [API](API.md)                        | Rotas e contratos                         |
| [Dados](DATA_MODEL.md)               | Entidades e integridade financeira        |
| [Supabase](SUPABASE_ARCHITECTURE.md) | Auth, Database, Storage, RLS e migrations |
| [Decisões](DECISIONS/)               | Decisões de arquitetura preservadas       |

## Desenvolvimento e operação

| Documento                                    | Conteúdo                                      |
| -------------------------------------------- | --------------------------------------------- |
| [Ambientes](ENVIRONMENTS.md)                 | Destinos permitidos, credenciais e isolamento |
| [Segurança](SECURITY.md)                     | Autenticação, permissões e proteção de dados  |
| [Publicação](DEPLOYMENT.md)                  | Build, configuração, verificação e promoção   |
| [Candidata de entrega](RELEASE_CANDIDATE.md) | Critérios e pendências da publicação atual    |
| [Cobertura de QA](QA_COVERAGE.md)            | Tipos de teste e execução                     |
| [Homologação](HOMOLOGACAO_2026_11_22.md)     | Resultados comprovados e limites              |
| [Performance](PERFORMANCE.md)                | Métricas, bundle e interpretação              |
| [Infraestrutura](infra/)                     | Scanner, email, runtime e templates           |
| [Ferramentas](../tools/README.md)            | Utilitários por domínio                       |

Os históricos de execução foram retirados desta árvore e preservados em arquivo privado. A documentação versionada deve explicar o sistema atual; logs, capturas, dumps, CSVs e inventários gerados ficam fora do repositório.
