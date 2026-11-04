# Etapa 2.3 — publicação restrita de DEF-004

Data: 2026-11-04. Worktree isolado: `C:/Users/jarde/Documents/GitHub/controle-livio-audit-stage2-validation-20261104`.

## Publicação e controle

- Branch: `validation/audit-stage2-20261104`.
- Commit novo: `f07071a4836e4f3cba83feeface366bff63ee27e`, filho direto de `422bac576ecf3dabe3883ba5e88c80ddc0ffc88a`.
- Ref remota confirmada no novo SHA após um commit e um push. Worktree da branch limpo.
- PR #3: `https://github.com/steveejobs/controle-livio/pull/3`, em rascunho, base `5521a3f1cebe38e8d89b0ceef38db808c5154fc9`, sem merge.
- Diff publicado: exatamente `apps/web/features/finance/receipt-capture.tsx`, `apps/web/e2e/receipt-identity.e2e.ts` e `apps/web/e2e/integrated/real-browser.integrated.e2e.ts`; 357 inserções e 10 remoções. O patch autorizado `etapa22-correcoes-locais.patch` e o diff staged tinham SHA-256 `def928b85cd559ddf2de68a217f09ded2bcf5b8edabe424a74f0fbe2c6e98dc6`.
- Os bloqueios de Git deployment da branch permanecem nos dois `vercel.json`; o workflow Quality consultado não contém etapa de deploy. Nenhuma operação de merge, deploy, migration hospedada ou alteração cloud foi solicitada nesta etapa.

## Evidência local do SHA publicado

- Playwright dirigido, com API simulada: 4/4 PASS em 360 e 1440 px. Inclui troca A (R$ 25,00) → B (R$ 33,34), seleção e confirmação por ID de B, edição preservada em rerender, troca de volta, respostas fora de ordem, falha/retentativa e bloqueio de identidade inconsistente. O teste novo reproduziu a prévia antiga antes da correção e passou depois.
- Format check: PASS em 384 arquivos. Lint e TypeScript: PASS. Vitest: 276 PASS; Prisma Validate e builds API/web: PASS no mesmo diff, executados na preparação da etapa 2.2, sem mudanças adicionais no código antes do commit.
- Esses testes locais não usam o PostgreSQL descartável da CI e não comprovam pagamento/alocação persistidos para `f07071a`.

## Quality e integração

Após o push, `git ls-remote` e a API de Git refs mostraram `f07071a`, mas até 11:10 UTC a API da PR ainda indicava head `422bac5`, a lista de Actions não mostrava um Quality novo e a API de check runs de `f07071a` retornou zero. A consulta de deployments do GitHub não retornou deployment da branch ou do novo SHA. O GitHub Status informava incidente ativo **“Incident with Pull Requests, Git Operations and Issues”**, em investigação. A coincidência temporal é uma hipótese para o atraso, não uma causa comprovada. Não houve novo push, atualização manual da PR nem disparo manual do workflow. Acompanhar a PR até que ela reconheça o commit e então coletar o run de Quality.

Enquanto não houver Quality no SHA novo: os 14 cenários integrados, pagamento válido de R$ 33,34, ID do recibo no banco, alocação, saldo final, idempotência e repetição dos cinco estados PIX em 360/1440 são **BLOCKED** por ausência de execução integrada. O Quality anterior #41811623745 pertence somente a `422bac5`: `application` PASS, `synthetic-restore` PASS, `supabase-isolation` FAIL; DEF-003 teve prova PostgreSQL para cinco estados em 360 px, mas o fluxo válido encontrou DEF-004.

## Próxima ação autorizada

Somente leitura: consultar PR #3 e Actions; se o Quality surgir, analisar os três jobs e o artefato sanitizado. Se falhar, diagnosticar e parar sem outro commit ou push. Production: **NO-GO**.
