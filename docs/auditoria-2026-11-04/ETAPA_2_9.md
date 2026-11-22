# Etapa 2.9 — fluxo de comprovantes aprovado em 360 e 1440 px

Data: 2026-11-04. Produção permanece NO-GO.

## Código, autorização e snapshot

- Repositório: steveejobs/controle-livio.
- Branch: validation/audit-stage2-20261104.
- Worktree: C:/Users/jarde/Documents/GitHub/controle-livio-audit-stage2-validation-20261104.
- SHA anterior: ac555fbbc3c16551d701124f65d9b28c28d59d45.
- SHA publicado: 20646dc2de791df88933996531852133cc462027.
- PR https://github.com/steveejobs/controle-livio/pull/3 permanece aberta, draft=true, merged=false. HEAD local, branch remota e refs/pull/3/head conferidos no SHA publicado.
- Um commit e um push, exclusivamente apps/web/e2e/integrated/real-browser.integrated.e2e.ts: oito inserções e duas remoções. Nenhum arquivo de produção, migration, fixture de negócio ou assertion financeira alterado. Nenhum teste desativado.
- Patch original conferido integralmente, SHA256 47759b0bb7e237d2146bee58a671e8c556eeecbe2e6c34570774392195a2a763.
- Quality automático da PR: https://github.com/steveejobs/controle-livio/actions/runs/41850303146, evento pull_request, headSha 20646dc2de791df88933996531852133cc462027.
- Logs dos três jobs confirmam checkout 91eff17d5c3c348208479c93a23c5e55beca14f4, merge sintético com pais 5521a3f1cebe38e8d89b0ceef38db808c5154fc9 e 20646dc2de791df88933996531852133cc462027.

## Correção exata

```diff
-      const paymentForm = await formWithSubmitButton(financePage, 'Confirmar pagamento');
+      const paymentForm = financePage
+        .getByRole('textbox', { name: 'Referência do pagamento', exact: true })
+        .locator('xpath=ancestor::form');
+      await expect(paymentForm).toHaveCount(1);
+      await expect(paymentForm).toBeVisible();

-      const preview = financePage.getByRole('region', { name: 'Conferência do comprovante' });
+      const preview = upload
+        .locator('xpath=..')
+        .getByRole('region', { name: 'Conferência do comprovante' });
```

Identidade da revisão verificada pelo título exclusivo do arquivo B e pelos campos esperados antes do clique; a confirmação precisa enviar o ID retornado pelo upload. Banco verifica documentId, document.paymentId, pagamento, parcela e alocação associados. Não foi introduzido ID artificial no DOM. Não há first/nth, remoção de recibos ou dependência de ordem visual.

O estado entre viewports é reutilizado: a fila de recibos de 360 permanece ao iniciar 1440. A correção delimita o formulário por um campo exclusivo e a revisão pelo contêiner de upload, distinguindo B da fila existente. Cada viewport usa sua própria nova cobrança/parcela e seus próprios IDs sintéticos.

## Verificações locais

Reprodução em Chromium com DOM sintético: quatro combinações 360/1440 × fila antes/depois do formulário. Em todas, seletor antigo falhou em strict mode com múltiplos botões; seletor corrigido identificou somente B, e os cinco recibos anteriores permaneceram inalterados após o clique sintético. A primeira tentativa do reproducer tinha submit HTML padrão, que navegava após o clique; somente o reproducer externo foi corrigido com type=button. Essa execução inicial não foi contada como PASS. Resultado final 4/4. Script e escopo em C:/Users/jarde/AppData/Local/Temp/livio-etapa29-local/reproduce-selectors.cjs; não é integração API/DB.

Format check, ESLint, TypeScript, Prisma Validate, builds API/web e git diff --check PASS. Playwright dirigido receipt-identity.e2e.ts com API simulada: 2/2, 360 e 1440 px. A integração real abaixo é evidência independente do runner.

## Quality

| Job                | Resultado | Escopo                                                                                                              |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------- |
| application        | PASS      | 277 Vitest (215 API, 42 web, 20 shared), 35 Playwright simulados, format/lint/TS/Prisma/builds/OCR compilado/bundle |
| synthetic-restore  | PASS      | Restore sintético em infraestrutura descartável                                                                     |
| supabase-isolation | PASS      | Auth/PostgreSQL RLS/Storage, ClamAV, SMTP local, navegador e validação de recibos                                   |

Relatórios JSON: focado expected=6; completo expected=14; ambos skipped=0, unexpected=0, flaky=0 e errors=[]. Nenhum cenário foi interrompido. As etapas de scanner timeout/indisponibilidade, migration/roles/RLS/identificadores e limpeza dos serviços descartáveis também concluíram.

Os 14 cenários completos cobrem: seletor de cliente; autenticação/navegação/membership; duas sessões/organizações; cliente/processo; contrato/parcelas/pagamentos; despesa/aprovação/pagamento; três rejeições de documentos inválidos; upload/download/assinatura; tarefa; portal/documentos/mensagem; perfis/isolamento; comprovantes. Essa contagem não representa cobertura de todas as funcionalidades do produto.

## PostgreSQL — comprovante B e pagamento parcial

Fontes: workflow-stages/receipt-valid-partial-360.json e receipt-valid-partial-1440.json. Somente identidades sintéticas descartáveis.

| Identidade/efeito                     | 360 px                                               | 1440 px                                              |
| ------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| receipt.id                            | efc72b02-e2ee-4842-9dc8-19f5b1fed93c                 | 33bca7b6-68be-4b30-8d9a-26db90634c46                 |
| document.id                           | eb2ca7ef-ebf9-432f-ad1b-a2cdbdb79b5c                 | b211ce0a-f083-4046-beba-735db4acee5b                 |
| document.title                        | Comprovante financeiro · recibo-parcial-6658b5f9.pdf | Comprovante financeiro · recibo-parcial-933923f4.pdf |
| installment.id                        | 3413b70a-e343-4281-aaa9-4ee297cfecb0                 | 3c343e4d-72f9-40cd-a052-e731758246ee                 |
| payment.id                            | 500ef518-0a37-427c-9736-459ca044a372                 | 1986dc09-81bf-410f-84b2-28caed037c77                 |
| allocation.id                         | 12f06d3e-90d9-4cfd-98f6-f5b235288746                 | d602ecf8-959c-453d-9673-5179fc34c54a                 |
| Upload/confirmar/repetir HTTP         | 201 / 201 / 201                                      | 201 / 201 / 201                                      |
| Valor confirmado/alocado              | 33.3400 BRL                                          | 33.3400 BRL                                          |
| Saldo antes/depois                    | 100.0000 / 66.6600 BRL                               | 100.0000 / 66.6600 BRL                               |
| Pagamentos/alocações da etapa parcial | 1 / 1                                                | 1 / 1                                                |
| Recibo/parcela                        | CONFIRMED / PARTIALLY_PAID                           | CONFIRMED / PARTIALLY_PAID                           |
| Histórico/auditoria do recibo         | 1 confirmação / 2 registros                          | 1 confirmação / 2 registros                          |
| Snapshot após repetição               | Igual ao anterior                                    | Igual ao anterior                                    |

Em ambos: POST/GET/listagem coerentes; documento e valor corretos na revisão; confirmationPath contém o receipt.id de B; document.paymentId corresponde ao pagamento; alocação usa a parcela da fixture do viewport. Consultas Prisma escopadas por organização/parcela/recibo, com Decimal exato. Repetição não criou pagamento/alocação nem alterou histórico/auditoria.

Os cinco recibos anteriores de cada fixture foram comparados antes/depois de B e da repetição: id, documentId, status, paymentId e reviewHistory preservados. A de R$ 25,00 (agendado): em 360, receipt a800a98f-3a40-43a7-99c1-a67d81749efc e document fac6f1a2-191c-4ce3-8ae9-b527a4e08253; em 1440, receipt e8246700-06a9-4b30-8c56-12d949be6b03 e document 11407414-c520-4876-ae51-b6d8267f3b01. Nenhum associado ao pagamento B.

## Quitação posterior

Fontes receipt-valid-final-360.json e receipt-valid-final-1440.json: nos dois viewports, comprovante de R$ 66,66 enviado pelo portal, cliente impedido de confirmar, isolamento entre clientes/organizações verificado, confirmação financeira com concorrência controlada e efeito único. Recibo CONFIRMED, um pagamento para esse recibo final, duas alocações totais da parcela [33.3400, 66.6600], saldo 0.0000, parcela/recebível PAID. Histórico desse recibo com uma revisão e auditoria com dois registros. Repetição HTTP 201 sem alterar contagens.

## DEF-003 — cinco estados nos dois viewports

Vinte artefatos receipt-nonsettlement-{360,1440}-*.json. Duas tentativas por estado e viewport, sem/com motivo de correção. Todas HTTP 400 com erro de domínio de operação não liquidada/devolvida. Em cada comparação antes/depois: PENDING_REVIEW, payment_id null, zero pagamentos vinculados ao recibo, zero alocações da parcela, saldo 100.0000 inalterado, zero revisões, somente uma auditoria de criação do recibo e nenhum novo evento de pagamento. Snapshots before==after em 20/20. Isso se refere às tentativas inválidas; posteriormente B altera o saldo legitimamente.

| Estado                 | Recibo 360                           | Recibo 1440                          | Resultado em cada viewport       |
| ---------------------- | ------------------------------------ | ------------------------------------ | -------------------------------- |
| Agendado               | a800a98f-3a40-43a7-99c1-a67d81749efc | e8246700-06a9-4b30-8c56-12d949be6b03 | 400/400, sem efeitos financeiros |
| Pendente               | e05947fc-b63d-417d-8d52-b2b9fe2217eb | 73b9283c-ac07-4450-97ab-ab45314ad600 | 400/400, sem efeitos financeiros |
| Cancelado              | c6999275-5f05-4e65-b979-0b5b80283182 | d4878a0f-1236-431a-8120-d06cf5eefbd4 | 400/400, sem efeitos financeiros |
| Devolvido              | e286bc55-28df-48ef-87b9-0a3b9994a985 | 8ff7c7b4-63fc-4878-907c-e0623f5f67d3 | 400/400, sem efeitos financeiros |
| Parcialmente devolvido | 80d4a935-7ce3-4c52-9b29-9dfc7ef0c991 | e6619d7c-bbb5-4ed6-b96e-f2bc3bea08f8 | 400/400, sem efeitos financeiros |

## Status no ambiente/escopo executados

| Item                | Resultado                                                                          |
| ------------------- | ---------------------------------------------------------------------------------- |
| RECEIPT_SELECTOR    | PASS — 360/1440, seleção determinística com fila preservada                        |
| DEF_004_INTEGRATED  | PASS — novo documento/valor/ID de confirmação coerentes nos dois viewports         |
| PAYMENT_VALID_PATH  | PASS — persistência parcial e quitação nos dois viewports                          |
| PAYMENT_IDEMPOTENCY | PASS — repetições e confirmação concorrente sem duplicação nos dois viewports      |
| DEF_003_REGRESSION  | PASS — cinco estados, vinte tentativas, PostgreSQL e dois viewports                |
| POSTGRES_INTEGRITY  | PASS — associações, valores, saldos, histórico e auditoria dos cenários executados |
| QUALITY_ALL_JOBS    | PASS — três jobs, 6/6 focados e 14/14 completos                                    |
| PRODUCTION_GO_NO_GO | FAIL — NO-GO operacional permanece                                                 |

## Controle de publicação e limites

Nenhum segundo commit/push, workflow manual, merge, deploy solicitado, alteração cloud, alias, variável hospedada ou migration no Supabase compartilhado. Bloqueios Vercel preservados. O Git da Vercel criou registro API dpl_FqRTAUjMTQx36ozsWuTJuQSMdzUZ para SHA 20646dc, CANCELED, builds=[], motivo de cancelamento: commit não afetou o projeto. Não foi executado build nem publicada versão por esse registro; não atribuir o cancelamento especificamente ao bloqueio de branch. Web não mostrou deployment novo. HEAD final limpo; outros worktrees e conflitos preservados.

Limites: Supabase/Auth/PostgreSQL/Storage e ClamAV são descartáveis do runner. A leitura Prisma administrativa não substitui testes separados de autorização/RLS. Os comprovantes são PDFs sintéticos com texto selecionável e revisão humana simulada por perfil autorizado. Não foi demonstrada liquidação bancária externa, autenticidade de documentos ou precisão geral de OCR em imagens reais. Este resultado não aprova hospedagem, scanner/SMTP hospedados, callbacks SSR hospedados, migrations reais, restauração operacional completa ou aceite do escritório.

## Retomada da auditoria cumulativa

Fluxo encerrado no escopo desta etapa; não adicionar novas variações opcionais para obter mais testes verdes. Preservar os 213 candidatos e a matriz existente, sem recontar handlers como funcionalidades.

Próxima frente proposta, por dependência: (1) concorrência de pagamentos parciais e estornos com snapshots de ledger/rollback e perda de permissão; (2) aprovação/pagamento/cancelamento de despesas concorrentes e comprovantes associados; (3) RG/CIN/CNH, conflito por campo, cancelamento de importação e persistência após refresh; (4) isolamento de organização/cliente e download privado nessas jornadas; (5) contratos/processos e demais candidatos sem evidência. Reutilizar apenas os testes já existentes quando aplicável e ampliar somente lacunas demonstráveis. Novos commits/pushes ou infraestrutura hospedada requerem autorização específica; não iniciados nesta etapa.

Relatório, diff e artefatos estão fora do checkout para manter a publicação limitada ao arquivo de teste autorizado e preservar os documentos conflitantes do checkout principal.
