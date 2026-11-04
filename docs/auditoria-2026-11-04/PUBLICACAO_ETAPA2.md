# Publicação de validação — histórico e resultado do Quality

## Estado anterior à autorização dos dois bloqueios de deployment

Data: 2026-11-04. Base exata: `5521a3f1cebe38e8d89b0ceef38db808c5154fc9`. Branch local: `validation/audit-stage2-20261104`. Commit local: `8958a073564c1cb38318a149c93d36eb57d7b613`, filho direto da base aprovada. Worktree: `C:/Users/jarde/Documents/GitHub/controle-livio-audit-stage2-validation-20261104`.

O patch autorizado foi lido integralmente e aplicado com `git apply --check` seguido de `git apply`. O diff contém exatamente oito arquivos, 155 inserções e oito remoções; a verificação reversa do patch passou. Nenhuma alteração HTTPS, migration, `.env`, segredo ou documento real foi incluída. O worktree isolado ficou limpo após o commit. O checkout principal e suas alterações preexistentes foram preservados.

## Arquivos do commit local (ainda não publicados)

- `apps/api/src/finance/receipt-interpretation.ts`
- `apps/api/src/finance/receipt.service.ts`
- `apps/api/src/finance/receipt.service.test.ts`
- `apps/web/features/clients/client-management.tsx`
- `apps/web/features/clients/identification-reader.ts`
- `apps/web/features/clients/identification-reader.test.ts`
- `apps/web/e2e/client-workspace.e2e.ts`
- `apps/web/e2e/integrated/real-browser.integrated.e2e.ts`

## Verificações locais do snapshot isolado

| Verificação                                | Resultado                                                     |
| ------------------------------------------ | ------------------------------------------------------------- |
| Instalação limpa `npm ci`                  | PASS, sem copiar `.env` ou dependências do checkout principal |
| Format check                               | PASS, 383 arquivos versionados                                |
| Lint / TypeScript                          | PASS / PASS                                                   |
| Testes API / web / shared                  | 214 / 42 / 20 PASS; total 276                                 |
| Prisma validate                            | PASS; não abre nem altera banco                               |
| Builds API / UI / web                      | PASS, URLs públicas e DATABASE_URL com placeholders loopback  |
| Playwright cliente 360/1440 px             | 2/2 PASS, API simulada e Tesseract real                       |
| Diff check / conferência dos oito arquivos | PASS                                                          |

A primeira tentativa Playwright não iniciou o servidor porque o novo processo estava sem as variáveis públicas de teste. Repetida com os mesmos placeholders loopback do build, passou. Não foi defeito da aplicação. A instalação reportou 20 vulnerabilidades de dependências (1 baixa, 16 moderadas, 3 altas); nenhum upgrade ou audit fix foi executado.

Esses 276 testes não são os 285 do checkout principal anterior: a base aprovada não contém os nove testes locais adicionais que ficaram fora do escopo autorizado. Nenhum PASS local foi convertido em PASS de PostgreSQL, Auth, Storage, RLS ou ClamAV reais.

## Bloqueio concreto de publicação

Os arquivos `apps/api/vercel.json` e `apps/web/vercel.json` da base aprovada desabilitam deploy Git somente para `validation/gha-ci-20261029`. A nova branch não está nessa regra. O patch autorizado não modifica esses arquivos. Portanto, conforme a restrição explícita do proprietário, a publicação foi interrompida por risco de Preview automático.

Proposta mínima ainda não aplicada: `etapa2-bloquear-deploy-nova-branch.patch`, adicionando apenas `"validation/audit-stage2-20261104": false` ao mapa `git.deploymentEnabled` dos dois arquivos. `git apply --check` dessa proposta passou. Aplicá-la e incluí-la no commit amplia o escopo para dez arquivos e depende de autorização adicional solicitada ao proprietário.

Push: **não executado**. PR: **não criada**. ID do Quality: **inexistente**. PostgreSQL real nesta rodada: **BLOCKED**. Production: **NO-GO**. Nenhum deploy, alteração cloud, migration hospedada ou escrita no Supabase compartilhado.

Após autorização dos dois bloqueios, a base proposta da PR é `validation/gha-ci-20261029`, confirmada remotamente em `5521a3f`; isso mantém o diff limitado à candidata e evita incluir o histórico entre a base aprovada e `main`. O job integrado existente executa em `pull_request`, inclusive PR em rascunho. Não fazer merge nem novo push automático em caso de falha.

## Continuação autorizada: publicação e Quality

O proprietário autorizou incluir os dois `vercel.json`, totalizando dez arquivos. Os projetos Vercel `controle-livio` (API) e `controle-livio-web` (web) foram conferidos por leitura da configuração Git; ambos apontam para este repositório e usam `main` como branch de Production. A regra `git.deploymentEnabled` da nova branch ficou explicitamente `false` nos dois projetos. O único workflow ativo do repositório é `.github/workflows/quality.yml`, sem etapa de deploy. O diff remoto contra a base aprovada contém exatamente os oito arquivos acima e `apps/api/vercel.json` e `apps/web/vercel.json`, sem migrations, `.env`, segredos, documentos reais ou código HTTPS. Consulta de deployments filtrada pela nova branch retornou zero nos dois projetos após o push e a abertura da PR.

O commit de configuração `b2aef448308603e46e2e427dca1b999b5731c876` foi criado sobre `8958a073564c1cb38318a149c93d36eb57d7b613` e enviado exclusivamente à branch `validation/audit-stage2-20261104`. A [PR #3](https://github.com/steveejobs/controle-livio/pull/3) foi aberta em rascunho contra `validation/gha-ci-20261029`, cujo HEAD era a base `5521a3f`. A PR e o compare remoto confirmaram dez arquivos e dois commits à frente da base, sem commits atrás. Nenhuma PR foi mesclada e nenhum deploy foi iniciado.

O [Quality #41808157317](https://github.com/steveejobs/controle-livio/actions/runs/41808157317) terminou **FAIL**: `application` PASS; `synthetic-restore` PASS; `supabase-isolation` FAIL apenas no passo de jornadas de navegador autenticadas. Nesse job, passaram isoladamente: Supabase Auth/PostgreSQL RLS/Storage, captura local de e-mail, scanner ClamAV limpo/EICAR e falha fechada, migration de recibos/papéis/RLS/identificadores. Navegador integrado: 6/6 cenários focados PASS; suíte completa 13/14 PASS. As jornadas completas 1–6, perfis e isolamento passaram; o cenário de comprovante falhou.

Falha exata: o teste novo fez leitura direta de `payment_receipts` por PostgREST com `service_role`, mas a migration de privilégios nega SELECT direto nessa tabela (`SQLSTATE 42501`). A falha ocorreu após upload do primeiro PIX agendado e duas respostas HTTP 400 para confirmação; a asserção de banco não executou. Portanto, os cinco estados de comprovante, os registros de pagamento/alocação e o PIX legítimo **não estão comprovados** neste SHA. Não alterar a política de segurança para satisfazer o teste. O teste foi preparado localmente para usar Prisma no PostgreSQL loopback descartável, com asserções diretas do recibo e das alocações; TypeScript web e ESLint direcionado passaram. Essa preparação é um diff **não commitado e não publicado** no worktree isolado. Uma nova CI exige autorização antes de qualquer novo commit ou push.

Evidência estruturada: `CI_41808157317.json`. O artefato sanitizado `integrated-supabase-browser-evidence` foi baixado apenas para diretório temporário local e resumido; screenshots e logs brutos não foram copiados para o repositório. Production permanece **NO-GO**.

## Etapa 2.1 — único commit corretivo do harness

Após autorização específica, o harness passou a usar Prisma com `DATABASE_URL` do runner, restrita a protocolo PostgreSQL, host loopback, `SUPABASE_LOCAL=true`, `SUPABASE_ENVIRONMENT=test` e `NODE_ENV=test`. O executor integrado agora repassa essa URL apenas ao processo Playwright; sua validação prévia de loopback e sanitização dos logs foram preservadas. As consultas são somente de leitura e escopadas por organização, recibo e parcela; a conexão é encerrada em `finally`. Nenhum grant, RLS ou migration foi alterado.

O commit `422bac576ecf3dabe3883ba5e88c80ddc0ffc88a` modificou somente `apps/web/e2e/integrated/real-browser.integrated.e2e.ts` e `tools/qa/run-integrated-browser-ci.mjs`. Localmente: 276/276 testes unitários, format check, lint, TypeScript, Prisma Validate e builds PASS. O diff foi conferido, os dois bloqueios de deployment permaneceram ativos, e o HEAD remoto anterior era exatamente `b2aef44`. O primeiro e o segundo envio do mesmo commit foram rejeitados por erro interno do GitHub sem alterar a branch; o terceiro foi aceito. Não houve outro commit nem outro push corretivo.

O [Quality #41811623745](https://github.com/steveejobs/controle-livio/actions/runs/41811623745) terminou FAIL: `application` PASS, `synthetic-restore` PASS, `supabase-isolation` FAIL no navegador completo. Auth/RLS/Storage, SMTP local, ClamAV limpo/EICAR/falha fechada e verificação de migration/papéis/identificadores de recibos passaram. Navegador: 6/6 focados, 13/14 completos.

**DEF-003 agora tem prova operacional para cinco estados em 360 px:** dez combinações (sem/com motivo) retornaram HTTP 400; PostgreSQL confirmou `PENDING_REVIEW`, `payment_id=null`, pagamentos do recibo 0, alocações da parcela 0, saldo `100.0000` antes/depois, recebível/parcela `OPEN`, histórico de revisão 0 e auditoria sem falso pagamento. O artefato sanitizado contém um JSON por estado e motivo. A suíte falhou depois: upload do recibo válido de R$ 33,34 retornou 201, mas a prévia continuou exibindo um recibo anterior de R$ 25,00. Causa confirmada em `ReceiptReview`: estado local `current` não acompanha a mudança da prop `receipt` entre uploads. Registrado como DEF-004. O caminho de comprovante válido, a prova de quitação no mesmo fluxo e a repetição da confirmação permanecem não executados nesta rodada. Nenhum novo push autorizado; Production NO-GO. Evidência resumida em `CI_41811623745.json`.
