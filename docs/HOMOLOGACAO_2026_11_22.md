# Homologação — 22/11/2026

A candidata funcional `2f29ae9c18895edd7dce08b54036dbc807cb7d40` passou os cinco jobs. O merge sintético executado foi `86773b917eebd9a315329e519b07b53932d5a3a7`.

- [Quality: quatro jobs aprovados](https://github.com/steveejobs/controle-livio/actions/runs/45039096039).
- [Recuperação: aprovada](https://github.com/steveejobs/controle-livio/actions/runs/45039095937).
- [PR #4](https://github.com/steveejobs/controle-livio/pull/4).

## Resultados

| Verificação                                        | Resultado                                        |
| -------------------------------------------------- | ------------------------------------------------ |
| Instalação e auditoria de dependências             | PASS; zero vulnerabilidades conhecidas           |
| Formato, lint, TypeScript, Prisma e builds API/web | PASS                                             |
| Vitest                                             | 491 PASS: API 362, web 71, banco 36, shared 22   |
| Ferramentas Node                                   | 208 PASS                                         |
| Interface com API simulada                         | 42 PASS                                          |
| Navegador integrado real                           | 17 PASS; zero falhas, skipped ou flaky           |
| Focused de navegador                               | 6 PASS, repetindo um subconjunto                 |
| Financeiro real                                    | 312 PASS                                         |
| Identidade e operações                             | 43 PASS                                          |
| Escopo de cliente                                  | 10 PASS                                          |
| Storage negativo                                   | 64 requisições PASS; oito células não executadas |
| Scanner real e captura local de email              | PASS                                             |
| Recuperação coordenada                             | 58 PASS; COMPLETE                                |
| PostgreSQL nativo e serviços                       | 15 PASS nas mesmas fontes                        |
| OCR compilado e bundle                             | PASS; 252.746 bytes gzip, limite 260.000         |

Os seis gates locais e os 491 testes foram repetidos na pasta principal antes da organização final. As contagens sobrepõem funcionalidades e não equivalem a percentual de cobertura.

## Integridade comprovada

As regressões verificam precisão Decimal, conflito CPF/CNPJ, SQLSTATE, retry serializável limitado, descarte de conexão após rollback, auditoria e isolamento. Asserções financeiras e de permissões não foram relaxadas para obter aprovação.

O ensaio coordenado restaurou SQL/Auth e 68 objetos físicos, comparou catálogos, FKs, owners/grants e hashes, validou login e API própria 200/externa 404. O destino descartável foi encerrado e a limpeza independente confirmou ausência dos seus containers/volumes.

## Limites

- A candidata precisa de homologação própria após implantação. A versão pública anterior respondeu aos cinco probes de disponibilidade; isso não comprova a candidata.
- Scanner, SMTP externo e schedulers hospedados continuam pendentes; a API Vercel está sem configuração de scanner listada.
- Câmera, push físico e Safari/iOS não foram homologados. Recorrência automática da agenda não foi comprovada.
- As oito células Storage não executadas não contam como PASS.
- O ensaio sintético não restaura backup histórico protegido, segredos ou configuração hospedada. O restore SQL mantém exclusões declaradas.
- Não há promessa de ausência universal de defeitos ou capacidade comercial a partir de carga sintética.

Relatórios brutos, capturas e logs foram retirados da árvore ativa. Os artefatos continuam nas execuções GitHub e no arquivo privado indicado em [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md). O manifesto anterior registra hashes de onze evidências.
