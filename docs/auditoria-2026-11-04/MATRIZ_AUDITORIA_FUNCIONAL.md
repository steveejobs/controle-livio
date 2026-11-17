# Matriz operacional vinculada ao catálogo

## Complemento cumulativo — etapa 3

Preservados os 213 candidatos e a matriz CSV original. `FINANCEIRO_FUNCIONAL_ETAPA3.json` e `MATRIZ_FINANCEIRA_ETAPA3.csv` relacionam os 71 candidatos financeiros a 28 funcionalidades reais (não handlers): 16 PARTIAL, 12 NOT_EXECUTED. Nenhuma funcionalidade agregada foi marcada PASS por carregamento de página ou teste unitário. As duas novas correções têm prova local limitada; 30 cenários novos de banco/concorrência estão BLOCKED para execução. O Quality 41850303146 é evidência histórica sobre 20646dc, e não da versão local modificada. Ver ETAPA_3_FINANCEIRO.md para dimensões, cenários, perfis, estados e limites. As linhas anteriores abaixo mantêm seus resultados históricos.

Etapa 2 (snapshot em `etapa2-snapshot.json`): DEF-002 revisão de conflito por campo = PARTIAL (Playwright real, API simulada, 1/1); DEF-003 classificação e bloqueio de cinco estados = PARTIAL (cinco regressões de domínio aprovadas, persistência simulada); DEF-003 integridade PostgreSQL = BLOCKED (extensão integrada preparada); DEF-001 formatos RG = PARTIAL (cinco casos adicionais aprovados, sem integração). Nenhum PASS de banco/RLS acrescentado.

`MATRIZ_AUDITORIA_FUNCIONAL.csv` enumera os 213 candidatos de rota/chamada, todos `NOT_EXECUTED` individualmente. Os cenários abaixo são unidades de comportamento verificadas nesta rodada. Não somar testes ou declarações para calcular cobertura funcional.

| ID      | Área / operação / perfil / estado                                       | Validação e persistência                                  | Integração          | Status  | Evidência                                                                 |
| ------- | ----------------------------------------------------------------------- | --------------------------------------------------------- | ------------------- | ------- | ------------------------------------------------------------------------- |
| AUD-001 | Cliente: parser de RG ilegível / navegador / campo ausente              | Não atribuir órgão ao RG; sem persistência                | Nenhuma             | PASS    | Teste falhou antes, passou após correção; `identification-reader.test.ts` |
| AUD-002 | Cliente: OCR e preenchimento / administrador / imagem sintética legível | Campos exibidos e aplicados; persistência simulada        | Tesseract navegador | PARTIAL | Playwright `client-workspace.e2e.ts` 360 px                               |
| AUD-003 | Cliente: criar, editar, contato / administrador / formulário válido     | Payload e atualização de interface; persistência simulada | API mockada         | PARTIAL | Playwright 360/1440 px                                                    |
| AUD-004 | Comprovante: extrair valor/data / sintético / PNG                       | Valor/data exatos; sem banco                              | Tesseract local     | PARTIAL | `receipt-extraction.service.test.ts`                                      |
| AUD-005 | Comprovante: extrair valor/data / sintético / JPEG                      | Valor/data exatos; sem banco                              | Tesseract local     | PARTIAL | Mesmo teste                                                               |
| AUD-006 | Comprovante: extrair valor/data / sintético / PDF texto                 | Valor/data exatos; sem banco                              | PDF.js              | PARTIAL | Mesmo teste                                                               |
| AUD-007 | Comprovante: extrair valor/data / sintético / PDF digitalizado          | Valor/data exatos; sem banco                              | PDF.js + Tesseract  | PARTIAL | Mesmo teste                                                               |
| AUD-008 | Financeiro: interpretar decimal/data brasileira / texto sintético       | Valores exatos; sem ledger                                | Nenhuma             | PARTIAL | `receipt-interpretation.test.ts`                                          |

Matrizes restantes: perfil × operação, estado × transição, validação × campo, persistência × entidade e integração × falha permanecem `NOT_EXECUTED` fora dos casos acima. Os CSVs não fazem inferência de aprovação a partir da presença de handler.
