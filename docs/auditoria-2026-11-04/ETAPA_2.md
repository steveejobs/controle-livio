# Etapa 2 — correções locais e integração preparada

Snapshot: HEAD `8f5cd3d93b240703292da81d24a9cdd0d065398a`, branch `validation/gha-ci-20261029`, único worktree. `git merge-base 8f5cd3d 5521a3f` retorna `8f5cd3d`: a base aprovada é descendente. A candidata HTTPS está no backup privado `%LOCALAPPDATA%/LivioBackups/limpeza-20261101-131401/sources/controle-livio-https-test`; não foi restaurada nem publicada. Alterações anteriores preservadas. O manifesto `etapa2-snapshot.json` registra hashes das fontes locais; não atribuir os resultados ao HEAD limpo ou à CI de outro SHA.

## Evidências novas

- DEF-003: cinco regressões de domínio falharam antes da correção: PIX agendado, pendente, cancelado, devolvido e parcialmente devolvido alcançavam `FinanceService.createPayment` mesmo com motivo de correção. Depois passaram; 22/22 testes dirigidos. O teste usa persistência simulada: o efeito no PostgreSQL permanece BLOCKED.
- Correção: interpretador preserva `nonSettlementEvidence` e emite alerta. A API bloqueia confirmação quando esse indício existe, inclusive com motivo. Nenhuma alteração de schema, recebíveis ou histórico existentes. Não há confirmação bancária externa.
- Limites: recibos históricos sem o novo campo não são reprocessados; texto OCR que omita ou erre a situação pode escapar da classificação; termos de devolução podem causar bloqueios conservadores. O financeiro ainda precisa conferir liquidação e beneficiário por fonte independente. Essas lacunas impedem declarar DEF-003 encerrado em produção.
- DEF-002: confirmação por campo mostra valor atual e extraído. Cancelar preserva o atual; aceitar aplica o sugerido. Campos ausentes continuam sem apagar valores. A revisão existente permite editar sugestões. O novo Playwright com Tesseract real e API simulada preservou nome divergente ao cancelar e o substituiu ao aceitar: 1/1 em 360 px. Persistência real e os demais conflitos permanecem pendentes.
- DEF-001: cinco casos adicionais cobrem RG com prefixo alfabético, dígito/letra final, linhas separadas e ausência de número. CIN/CNH/PDF de identidade, fotos degradadas e métricas amplas continuam NOT_EXECUTED.

## Integração descartável pronta para publicação

O job existente `supabase-isolation` já inicia Supabase, Auth, PostgreSQL, Storage e ClamAV em loopback e executa `run-integrated-browser-ci.mjs`. Não é necessária alteração de workflow para descobrir a extensão da jornada `comprovante`.

O teste ampliado envia cinco PDFs sintéticos pelo formulário real, chama a API de confirmação duas vezes por recibo e consulta PostgreSQL pela API REST local com a credencial exclusiva do runner: exige `PENDING_REVIEW`, `payment_id=null` e zero alocações na parcela. Asserções de erro no banco também são obrigatórias. O teste foi descoberto pelo Playwright, mas não executado nesta máquina.

Arquivo revisável `etapa2-correcoes-sobre-5521a3f.patch`: oito arquivos, 155 inserções e oito remoções sobre a base aprovada, sem transportar o diff completo do checkout antigo. Verificação reversa do patch passou contra os oito arquivos atuais. Inclui DEF-001, DEF-002, DEF-003 e regressões. Necessita autorização específica de commit/push em branch isolada baseada em `5521a3f`, com posterior execução Quality. Nenhum commit/push/disparo remoto foi feito.

## Cobertura e pendências

Validação final local: format check, lint, TypeScript, Prisma validate, builds API/web e `git diff --check` PASS. Testes: 223 API + 42 web + 20 shared = 285 PASS. Playwright dirigido DEF-002: 1/1 PASS. A listagem integrada não executa testes; seu relatório temporário foi removido para preservar a remoção preexistente desse arquivo. Para executar todos os jobs em branch isolada, abrir PR em rascunho após autorização (o workflow já aceita `pull_request`).

Os 213 candidatos originais foram preservados. Nenhum novo PASS de persistência, RLS ou concorrência foi atribuído. DEF-002: PARTIAL; DEF-003: PARTIAL; DEF-001 integrado: BLOCKED; integração real: BLOCKED; produção: FAIL/NO-GO.

Próxima execução: rodar o patch no Actions, conferir alocações e histórico, depois ampliar concorrência controlada de pagamento/estorno/despesa, perda de permissão e isolamento A/B. Também faltam PIX realizado/duplicado, beneficiário divergente, boleto emitido versus pago, recibo e transferência entre contas. Os testes existentes de concorrência não substituem essa ampliação.
