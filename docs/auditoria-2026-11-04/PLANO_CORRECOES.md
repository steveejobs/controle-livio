# Plano de correções e validações

1. Reproduzir `DEF-003` em PostgreSQL/Auth/Storage/ClamAV descartáveis e bloquear confirmação de operações não liquidadas antes de qualquer piloto financeiro. Testar agendado, cancelado, devolvido, valores múltiplos, repetição e concorrência.
2. Definir regra de conflito para `DEF-002`: mostrar valores atuais e sugeridos, exigir escolha explícita por campo; provar que a revisão persiste sem perdas após refresh.
3. Ampliar fixtures OCR sintéticas e ground truth por campo. Incluir RG, CIN, CNH, frente/verso, fotos difíceis, PIX, TED, boleto, recibo e PDF digitalizado; medir precisão, cobertura, invenção e tempo.
4. Executar matriz de perfis/organizações e armazenamento em ambiente isolado; verificar acesso direto à API, RLS, signed URLs, scanner fail-closed e erro depois de upload.
5. Homologar Auth, templates/SMTP, gateway scanner, builds e restore em hospedagem TEST isolada; só então reavaliar NO-GO.

`DEF-001` foi corrigido localmente e tem teste de regressão. Nenhuma outra correção foi aplicada nesta rodada.

## Próxima ação após Quality #41811623745

1. Corrigir `DEF-004` na interface de revisão para que novo upload substitua a prévia anterior pelo recibo recém-criado, mantendo confirmação vinculada ao ID exibido. Adicionar regressão de múltiplos uploads na mesma sessão e executar a jornada integrada de recibo válido, pagamento parcial, quitação, repetição e negação por usuário não autorizado. Essa alteração de produto requer autorização de nova publicação; não há push adicional nesta etapa.
2. Repetir os cinco estados de `DEF-003` também em 1440 px depois de liberar o restante da jornada. Preservar as dez provas de PostgreSQL já aprovadas em 360 px e ampliar para estados OCR com texto degradado e fontes bancárias independentes antes de homologação.
3. Manter Production NO-GO. O Quality completo segue FAIL porque a jornada de recibo válido não alcançou o ledger final; a passagem das demais jornadas não substitui essa prova.
