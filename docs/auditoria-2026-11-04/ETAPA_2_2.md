# Etapa 2.2 — correção local de DEF-004

Data: 2026-11-04. Worktree isolado: `C:/Users/jarde/Documents/GitHub/controle-livio-audit-stage2-validation-20261104`. Branch `validation/audit-stage2-20261104`; HEAD local e remoto publicado `422bac576ecf3dabe3883ba5e88c80ddc0ffc88a`; base da PR #3 `5521a3f1cebe38e8d89b0ceef38db808c5154fc9`. PR permanece em rascunho. Esta etapa contém **somente mudanças locais não commitadas**; não houve push, deploy, migration ou alteração cloud.

## Causa e reprodução

O Quality #41811623745 enviou um recibo válido de R$ 33,34 com HTTP 201, mas a revisão ainda mostrava o recibo anterior de R$ 25,00. No código, `ReceiptCapture` chamava `setReceipt(result)`, enquanto `ReceiptReview` guardava `current` inicializado de `receipt` apenas no primeiro mount. Como o filho mantinha a mesma posição na árvore React, a troca da prop não atualizava título, valor, beneficiário, formulário nem ID das ações. O teste novo `receipt-identity.e2e.ts` falhou **antes da correção** em 360 px com A de R$ 25,00 e B de R$ 33,34: após B, a revisão ainda mostrava `Comprovante receipt-a`.

## Correção preparada

- `ReceiptCapture` invalida a revisão anterior no início de novo upload e renderiza `ReceiptReview` com `key={receipt.id}`. Rerenders do mesmo recibo preservam campos manuais; a troca de ID remonta campos, feedback e estado de revisão.
- Geração monotônica de upload ignora respostas e erros de requisições anteriores que terminem fora de ordem. Falha de upload deixa a revisão vazia e permite retentativa.
- Resposta com ID/documento/vínculo financeiro incompatível é rejeitada localmente. A revisão bloqueia download, confirmação e decisões se ID, documento ou vínculo deixarem de coincidir com a prop atual. A confirmação usa o ID do recibo exibido.
- Nenhuma API, regra de domínio, banco, RLS, scanner ou configuração de deployment foi alterada.

## Verificações locais

| Verificação                                 | Resultado                                                                                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Playwright novo, 360 e 1440 px              | 2/2 PASS com API simulada; A→B, ID confirmado de B, beneficiário, edição manual preservada, erro/retry, resposta fora de ordem, confirmação antiga em andamento, identidade incompatível, seleção de arquivo cancelada e fila após recarga |
| Playwright dirigido com decisões existentes | 4/4 PASS, 360 e 1440 px                                                                                                                                                                                                                    |
| Vitest API / web / shared                   | 214 / 42 / 20 PASS; total 276                                                                                                                                                                                                              |
| Format check                                | PASS, 383 arquivos versionados; arquivo novo conferido separadamente                                                                                                                                                                       |
| Lint / TypeScript                           | PASS / PASS                                                                                                                                                                                                                                |
| Prisma Validate                             | PASS, sem conexão mutável                                                                                                                                                                                                                  |
| Builds API e web                            | PASS com URLs públicas e DATABASE_URL placeholders loopback                                                                                                                                                                                |
| Git diff check / patch reverso              | PASS / PASS                                                                                                                                                                                                                                |

O teste integrado `real-browser.integrated.e2e.ts` foi ampliado para exigir que a URL de confirmação use o ID retornado no upload válido, que o documento persistido tenha o mesmo ID e título, que o pagamento esteja ligado a esse documento e que os cinco recibos bloqueados continuem pendentes e sem pagamento após a confirmação parcial. A jornada existente já percorre ambos os viewports. **Ela não foi executada no PostgreSQL após esta correção local**: nova publicação e Quality dependem de autorização específica.

Os cinco bloqueios DEF-003 de #41811623745 permanecem como evidência do SHA publicado: dez tentativas em 360 px, HTTP 400, recibos `PENDING_REVIEW`, nenhum pagamento/alocação indevida e saldo R$ 100,00 inalterado. A correção local de UI ainda precisa repetir essa prova em 360/1440 px; não atribuir o PASS anterior ao diff local.

## Diff para revisão

Patch completo: `etapa22-correcoes-locais.patch`, SHA-256 `def928b85cd559ddf2de68a217f09ded2bcf5b8edabe424a74f0fbe2c6e98dc6`, conferido com `git apply --reverse --check` no worktree modificado. Contém exatamente três arquivos: `apps/web/features/finance/receipt-capture.tsx`, `apps/web/e2e/receipt-identity.e2e.ts` (novo) e `apps/web/e2e/integrated/real-browser.integrated.e2e.ts`; 357 inserções e 10 remoções. Os dois `vercel.json` publicados permanecem intactos.

## Estado e próxima execução

DEF-004 UI: **PASS local com API simulada**. Consistência de ID na interface: **PASS local**, integração PostgreSQL **NOT_EXECUTED** nesta versão. Pagamento legítimo por comprovante, quitação, idempotência válida e ausência de associação ao recibo anterior: **BLOCKED** até novo Quality. DEF-003 PostgreSQL: **PASS no SHA anterior apenas**, repetição desta versão **NOT_EXECUTED**. Production: **NO-GO**. Não fazer commit, push ou deploy sem nova autorização.
