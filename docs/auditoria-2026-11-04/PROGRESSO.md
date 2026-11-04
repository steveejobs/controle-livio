# Continuidade da auditoria

## Etapa 3 — mudanças locais sobre 20646dc, ainda sem CI

O Quality 41850303146 encerrou a etapa 2.9 com três jobs PASS, 6/6 focados e 14/14 completos em 360/1440; relatório preservado em ETAPA_2_9.md. Etapa 3 usa o mesmo HEAD versionado com mudanças locais não publicadas. Dois defeitos reproduzidos e corrigidos em domínio/adaptador: DEF-006 renegociação de cancelado/baixado; DEF-007 remoção Storage que ignorava erro do SDK. Vitest 284/284 e 16 testes de segurança/contrato do harness passaram. Os 30 cenários PostgreSQL novos estão preparados e BLOCKED por ausência de Docker/servidor local e autorização para publicação. Há risco potencial P0 de escrita financeira direta via RLS, ainda não reproduzido, com teste negativo preparado; não prometer CI verde nem afrouxá-lo. Catálogo financeiro: 71 candidatos vinculados a 28 funções; 16 PARTIAL e 12 NOT_EXECUTED; total global continua indeterminado. Ver ETAPA_3_FINANCEIRO.md, MATRIZ_FINANCEIRA_ETAPA3.csv e VALIDACAO_ETAPA3.json. Próximo passo: revisão do diff consolidado e autorização específica de commit/push apenas para runner descartável. Não aplicar migrations ou usar Supabase compartilhado. Checkout principal e conflitos preservados.

## Etapa 2.5 — CI divergente, DEF-005 HTTP comprovado localmente

Branch remota `f07071a`, PR #3 e `refs/pull/3/head` ainda `422bac5`, merge sintético antigo; zero check suite/run do SHA novo. PR draft sem conflito de merge. Incidente GitHub foi resolvido às 11:50 UTC, mas a PR seguia antiga às 12:15; causa individual ainda hipótese. Workflow Quality da branch tem `workflow_dispatch`, mas o default `main` não, e os jobs integrados seriam pulados num dispatch da branch. Nenhum disparo executado. Vercel API/web públicos continuam em versões antigas, sem deployment de `f07071a`; 404 de GET recibos é ausência da rota na API antiga, enquanto o controller GET está registrado na candidata. Worktree destacado `controle-livio-audit-stage25-local` recebeu extração pequena da configuração CORS e sete regressões HTTP: callback antigo produziu 2 falhas por 500 em 6 cenários; corrigido 7/7 PASS após acrescentar guard sintético. Suíte completa de 282 Vitest, format, TypeScript, Prisma e builds passou antes do sétimo cenário; lint e TypeScript API repetidos depois PASS. Nenhum commit/push/deploy. TEST isolado e ClamAV hospedado continuam sem prova. Ver `ETAPA_2_5.md`; próximo passo é obter autorização específica para sincronizar a mesma PR, se persistir a divergência. Production NO-GO.

## Validação pós-deploy — aliases públicos permanecem em versões anteriores

Em 2026-11-04, consultas somente leitura na Vercel identificaram API pública `dpl_6yjRxg682u9ZbL5MWZcgMQZUZivq` (SHA declarado `919a5ac`, `gitDirty=1`) e web pública `dpl_DgnASidnQrWVzEEFsyRGospAhfnb` (SHA `ba1a9b8`), ambos Production e anteriores a `f07071a`. Nenhum deployment do SHA novo foi listado; PR #3/Quality ainda mostram `422bac5`. API live/ready retornam JSON 200, `/v1/clients` sem token 401, rota de recibos 404; o domínio de projeto devolve Login Vercel HTML 200 no health. CSP da web aponta à API pública e a Supabase compartilhado; `CLAMAV_HOST` ausente das variáveis da API. Preflight CORS de origem externa reproduziu HTTP 500 (DEF-005/P2). Nenhum teste mutável hospedado foi executado por Production/TEST não comprovado. Relatório completo em `VALIDACAO_POS_DEPLOY_2026-11-04.md`. O checkout principal agora tem conflitos de merge preexistentes, inclusive `PROJECT_CONTEXT.md`; preservar e não editar até resolução pelo proprietário. Production NO-GO.

## Etapa 2.3 — commit publicado, Quality ainda não disparado

O único commit/push autorizado publicou `f07071a4836e4f3cba83feeface366bff63ee27e` na branch `validation/audit-stage2-20261104`, somente nos três arquivos DEF-004 aprovados (357 inserções, 10 remoções). Worktree isolado limpo; PR #3 permanece em rascunho e sem merge. A ref remota já aponta ao novo SHA, mas a API da PR e a lista de Actions ainda mostram `422bac5`; há incidente ativo do GitHub envolvendo Pull Requests/Git. Nenhum Quality novo foi atribuído a `f07071a`. Gates locais e Playwright mockado 4/4 em 360/1440 PASS. PostgreSQL, pagamento válido, idempotência e regressão DEF-003 no novo SHA aguardam Quality. Não fazer outro push/commit nem disparar workflow alternativo. Ver `ETAPA_2_3.md`. Production NO-GO.

## Etapa 2.2 — preparação local, sem publicação

Worktree isolado `controle-livio-audit-stage2-validation-20261104`, branch `validation/audit-stage2-20261104`, HEAD `422bac576ecf3dabe3883ba5e88c80ddc0ffc88a`. DEF-004 reproduzido no Playwright antes da correção: A R$ 25,00 permanecia após upload B R$ 33,34. Correção local em `ReceiptCapture/ReceiptReview`: remount por ID, invalidação de revisão durante upload, proteção contra resposta fora de ordem e rejeição de identidade/vínculo incompatível. Novo Playwright 2/2 PASS em 360/1440; junto das decisões existentes 4/4 PASS. Vitest 276, format, lint, TypeScript, Prisma, builds e diff check PASS. Teste integrado ampliado para exigir ID/documento/pagamento correspondentes; ainda **não executado** com PostgreSQL nesta versão. Diff exato em `etapa22-correcoes-locais.patch`, relatório em `ETAPA_2_2.md`. Próximo passo: revisão e autorização específica de commit/push; então Quality descartável, DEF-003 em ambos viewports, pagamento legítimo, quitação e idempotência. Production NO-GO.

## Etapa 2.1 — Quality #41811623745

SHA publicado `422bac576ecf3dabe3883ba5e88c80ddc0ffc88a`, PR #3 continua em rascunho, branch isolada limpa, base `5521a3f`. Commit único da etapa alterou apenas o teste integrado de comprovantes e o executor que repassa a URL PostgreSQL loopback ao Playwright. Local: 276 testes, format, lint, TypeScript, Prisma e builds PASS. CI: `application` PASS, `synthetic-restore` PASS, `supabase-isolation` FAIL; navegador 6/6 focados e 13/14 completos.

Verificação concluída: PIX agendado, pendente, cancelado, devolvido e parcialmente devolvido, cada um com duas tentativas sem/com motivo, em 360 px. Dez rejeições HTTP 400; PostgreSQL descartável confirmou recibos pendentes, zero pagamentos por recibo, zero alocações, saldo `100.0000` inalterado, histórico e auditoria sem confirmação falsa. O caminho legítimo parou após upload 201 de R$ 33,34 porque a prévia continuou exibindo R$ 25,00 do recibo anterior (DEF-004, causa confirmada em estado React). Não houve pagamento válido neste cenário, nem execução dos mesmos estados em 1440 px. Próximo módulo: corrigir DEF-004 após autorização de publicação, testar nova prévia/ID e repetir o caminho válido, idempotência e isolamento. Nenhum novo push automático. Evidência: `CI_41811623745.json` e artefato sanitizado do Actions. Production NO-GO.

## Estado atual após Quality #41808157317

Branch isolada `validation/audit-stage2-20261104`, base `5521a3f1cebe38e8d89b0ceef38db808c5154fc9`, SHA publicado `b2aef448308603e46e2e427dca1b999b5731c876`, PR #3 em rascunho. Os dez arquivos autorizados estão publicados; bloqueio de deployment configurado nos dois `vercel.json`; zero deployments observados na nova branch. O Quality terminou FAIL: `application` e `synthetic-restore` PASS; `supabase-isolation` FAIL na leitura direta de banco do teste novo de comprovantes. Auth/RLS/Storage, ClamAV, SMTP local, migração e identificadores de recibos passaram. Navegador integrado: 6/6 focados, 13/14 completos.

Próximo passo técnico: corrigir a sondagem de banco de DEF-003 para usar Prisma com PostgreSQL loopback. Essa correção está preparada e passou TypeScript e lint localmente, mas **não foi publicada nem executada na CI**. Nenhum novo commit ou push sem autorização. Após nova CI, confirmar cinco estados PIX no recibo, pagamentos, alocações e saldo, depois o pagamento legítimo e a idempotência. Ver `PUBLICACAO_ETAPA2.md` e `CI_41808157317.json`. Production: NO-GO.

## Validação isolada autorizada — estado de publicação

Commit local `8958a073564c1cb38318a149c93d36eb57d7b613` criado em `validation/audit-stage2-20261104`, filho de `5521a3f`, somente oito arquivos do patch autorizado. Instalação limpa e gates PASS; 276 testes e 2/2 Playwright mockados. Push/PR/Quality interrompidos antes da publicação por risco de deploy: os dois vercel.json bloqueiam apenas a branch antiga. Ver `PUBLICACAO_ETAPA2.md` e proposta `etapa2-bloquear-deploy-nova-branch.patch`, ainda não aplicada. Retomar após decisão explícita sobre os dois bloqueios; não presumir autorização pelo tempo decorrido.

## Etapa 2

Consultar `ETAPA_2.md`, manifesto `etapa2-snapshot.json` e patch restrito sobre `5521a3f`. DEF-002 tem confirmação por campo e teste de navegador aprovado; DEF-003 foi reproduzido em cinco testes de domínio, corrigido na API e tem extensão integrada pronta, ainda sem execução PostgreSQL. Nenhuma publicação autorizada ou executada. Retomar pelo Actions após aprovação específica.

## Concluído em 2026-11-04

- Estado do checkout, worktree e arquivos pessoais conferidos; nenhuma alteração preexistente descartada.
- Documentação de produto, arquitetura, ambiente, cobertura, ADR de recibos e auditorias anteriores consultadas.
- Inventário estático gerado: 841 declarações; 130 rotas API e 83 chamadas web catalogadas como candidatos.
- `DEF-001` reproduzido, corrigido e coberto por regressão.
- Gates: format check, lint, typecheck, 275 testes, Prisma validate, builds aprovados.
- Playwright cliente em 360/1440 px: 2/2, repetido após build; API simulada.
- Playwright mockado completo no build atualizado: 33/33 em 2,3 min, sem falhas; não equivale a integração real.
- Nenhum arquivo real enviado a OCR ou incorporado à evidência.

## Próximo módulo

Comprovantes financeiros em ambiente descartável, começando por situação agendada/cancelada/devolvida e confirmação concorrente. Depois, cadastro com conflito de campos OCR e persistência real.

## Dependências

Não há Docker, Supabase CLI ou psql nesta máquina; `.env` atual não é alvo seguro para teste mutável. Ambiente TEST isolado, ClamAV e credenciais sintéticas são necessários para integração. Não aplicar migrations sem confirmação do banco de desenvolvimento. Não usar os documentos pessoais de Downloads em CI ou serviços externos.

## Contagens honestas

Funcionalidades reais únicas: indeterminadas. Operações de API identificadas: 130. Chamadas web: 83. Candidatos catalogados: 213. Unidades de comportamento individualmente ligadas à matriz: 8 (1 PASS, 7 PARTIAL). Cenários de navegador: 33 mockados, incluindo os 2 de clientes repetidos. Testes unitários: 275. Esses totais não têm o mesmo denominador e não devem ser somados.
