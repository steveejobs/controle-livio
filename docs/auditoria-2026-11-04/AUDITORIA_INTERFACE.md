# Interface

O navegador executou `client-workspace.e2e.ts` com API simulada em 360 e 1440 px: cadastro de cliente, leitura de imagem sintética no caso 360, edição, contato e comunicação passaram (2/2). O Playwright foi repetido com sucesso após o build que inclui a correção do parser. A suíte mockada completa do mesmo build passou 33/33 cenários em 2,3 min: administração, relatórios, auditoria, paginação, portal, tarefas, agenda, documentos, despesas, pagamentos, PWA, recibos e assinatura. Rotas públicas/privadas e os demais componentes foram inventariados estaticamente em `superficie-estatica.json`.

| Dimensão                                                      | Estado                    |
| ------------------------------------------------------------- | ------------------------- |
| 360 e 1440 px, jornada de cliente mockada                     | PASS no build atualizado  |
| 390 e 768 px                                                  | NOT_EXECUTED              |
| Persistência após refresh, backend real                       | NOT_EXECUTED              |
| Teclado, foco, contraste, loading/erro, todos os modais/menus | NOT_EXECUTED nesta rodada |
| Jornadas listadas na suíte mockada                            | PARTIAL; 33/33 cenários   |
| Estados condicionais fora dos cenários existentes             | NOT_EXECUTED              |

Não há evidência de que cada botão, filtro ou exportação listado no inventário funcione integralmente.
