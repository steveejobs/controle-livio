# Homologação — 22/11/2026

A candidata funcional `2f29ae9c18895edd7dce08b54036dbc807cb7d40` passou os cinco jobs. O merge sintético executado foi `86773b917eebd9a315329e519b07b53932d5a3a7`.

- [Quality: quatro jobs aprovados](https://github.com/steveejobs/controle-livio/actions/runs/45039096039).
- [Recuperação: aprovada](https://github.com/steveejobs/controle-livio/actions/runs/45039095937).
- [PR #4](https://github.com/steveejobs/controle-livio/pull/4).

## Resultados

### Publicação Vercel

O erro de configuração ClamAV foi resolvido. API, web e scanner foram promovidos e seus aliases conferidos. API live/ready 200, clients sem login 401, web/reset/worker 200 e CORS 204. Chrome real em 360/1280 px verificou formulário e foco por teclado, sem overflow ou erros JavaScript. Esses probes não gravam negócios no banco compartilhado.

O scanner HTTPS hospedado aceitou limpo e identificou EICAR; o cliente compilado da API lançou 422 para infectado. Autenticação incorreta 401, método inválido 404 e arquivo excedido 413. [Pacote scanner 45092197283](https://github.com/steveejobs/controle-livio/actions/runs/45092197283) PASS, incluindo Compose/TLS e container Vercel sob 2 GiB/uma CPU/raiz somente leitura/scratch limitado, FreshClam e reinicialização. Pico de memória: 1.220.866.048 bytes. Gates locais repetidos com 491 Vitest e 219 testes Node aprovados. Ver [contexto](../PROJECT_CONTEXT.md) para identidades e CI atual.

Versão final de código 7da4a69: [Quality 45092197197](https://github.com/steveejobs/controle-livio/actions/runs/45092197197) 4/4 PASS, [recuperação 45092197219](https://github.com/steveejobs/controle-livio/actions/runs/45092197219) PASS e pacote scanner PASS: seis jobs aprovados na mesma versão. As fontes executáveis dos deployments publicados foram comparadas com essa versão sem diferenças.

### Homologação funcional anterior

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

- A publicação teve probes hospedados e prova real do scanner; a jornada autenticada completa com dados reais não foi executada. As jornadas de negócio completas usam infraestrutura CI isolada.
- SMTP externo e schedulers hospedados continuam pendentes. O scanner já está configurado e hospedado; crescimento das bases, cotas e execução contínua precisam de monitoramento.
- Câmera, push físico e Safari/iOS não foram homologados. Recorrência automática da agenda não foi comprovada.
- As oito células Storage não executadas não contam como PASS.
- O ensaio sintético não restaura backup histórico protegido, segredos ou configuração hospedada. O restore SQL mantém exclusões declaradas.
- Não há promessa de ausência universal de defeitos ou capacidade comercial a partir de carga sintética.

Relatórios brutos, capturas e logs foram retirados da árvore ativa. Os artefatos continuam nas execuções GitHub e no arquivo privado indicado em [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md). O manifesto anterior registra hashes de onze evidências.
