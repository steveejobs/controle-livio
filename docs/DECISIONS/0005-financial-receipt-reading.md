# ADR 0005: leitura local e conferência de comprovantes

- Status: implementação local preparada; integração no ambiente descartável pendente.
- Data: 2026-10-31.

## Contexto

O ledger já possui pagamentos idempotentes, alocações, saldo Decimal, documentos privados e varredura ClamAV. Comprovantes enviados por clientes não comprovam liquidação bancária. Uma leitura automática deve sugerir dados sem assumir autenticidade ou alterar o ledger antes da revisão.

## Decisão

- Usar o upload de `DocumentsService`, com limites existentes, validação de conteúdo, scanner fail-closed e Storage privado. O comprovante recebe categoria `PAYMENT_RECEIPT` e vínculo com parcela ou despesa. Um scanner adicional roda antes da extração. O arquivo original não é alterado.
- Ler até três páginas de PDF com PDF.js. Se valor ou data não estiverem no texto nativo, renderizar as páginas e executar OCR local em português com Tesseract.js. Para JPG/PNG, usar OCR local e duas rotações de tentativa quando necessário. Limitar a quatro milhões de pixels por página, duas leituras simultâneas e quinze segundos por operação OCR. DOCX e WebP não entram neste fluxo inicial.
- Persistir somente os campos interpretados, origem (`PDF_TEXT` ou `OCR`), confiança, comparação financeira e alertas. Não persistir o texto OCR bruto. A confiança é uma indicação para revisão, não uma garantia de precisão.
- O cálculo usa `Prisma.Decimal`, saldo atual do ledger e a fórmula nominal − desconto + juros + multa. Datas `DD/MM/YYYY` são validadas estritamente; o dia de pagamento é comparado no fuso da organização. A interface mostra valor, datas, diferença e alertas antes de confirmar.
- `payment_receipts` guarda hash SHA-256 único por organização, documento, alvo financeiro, estado e histórico de revisão. A tabela tem RLS forçada sem acesso direto do navegador; a API exige permissão específica e filtra organização/cliente. Triggers verificam tenant e cliente do alvo. O papel cliente pode enviar e consultar apenas seus comprovantes, mas não confirmar pagamentos.
- Confirmação pela equipe usa as transações existentes de `FinanceService`: bloqueio da parcela ou despesa, idempotência `receipt:<id>`, unicidade do E2E no pagamento, atualização do comprovante e vínculo do documento na mesma transação. Divergências exigem motivo. Excedente não é alocado automaticamente. Reenvio do mesmo arquivo retorna conflito.
- `audit_logs` registra envio, revisão, correções e confirmação sem texto OCR ou CPF/CNPJ. O histórico original dos campos extraídos não é reescrito.

## Limites e validação pendente

- O OCR pode errar. Não existe validação bancária externa; o estado `CONFIRMED` significa conferência humana no Lívio.
- A leitura não decodifica códigos de barras a partir de pixels; extrai a linha digitável quando impressa em texto. Resultado inconclusivo exige preenchimento e motivo pelo financeiro.
- O pacote de OCR e o renderizador de PDF precisam ser testados no build e no tempo máximo real da hospedagem Vercel antes de uso comercial. Os testes locais não comprovam empacotamento de binários ou dados de idioma na função hospedada.
- A migration oficial está versionada, mas não foi aplicada ao Supabase compartilhado. A suíte integrada em PostgreSQL/Auth/Storage/ClamAV descartáveis depende de um runner autorizado para o commit.
