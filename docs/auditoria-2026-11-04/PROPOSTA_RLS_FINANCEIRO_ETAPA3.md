# Revisão necessária: escrita financeira direta por PostgREST

Estado: hipótese concreta de bypass, **não reproduzida em PostgreSQL na etapa 3**. Nenhuma migration criada ou aplicada.

## Evidência estática

- A policy tenant_update de payments/expenses usa has_permission para ação update.
- O papel finance possui payments:update e expenses:update.
- Estorno via controller exige payments:approve e administrator. Aprovação de despesa exige permissão e separação de criador/aprovador; pagamento exige estado APPROVED.
- O trigger protect_confirmed_payment não inclui status entre os campos imutáveis. Os checks de expenses não implementam toda a máquina de estados/auditoria do serviço.

O teste RLS-WRITE da rodada consolidada usa JWT real de financeiro e tenta mudar diretamente o estado de um pagamento confirmado para REVERSED e de uma despesa DRAFT para PAID. Antes/depois devem permanecer iguais. Se houver alteração, a prova deve permanecer vermelha e os dados sintéticos ficam retidos para inspeção; nenhum audit log será apagado.

## Alternativa mínima para revisão, após reprodução

Manter SELECT condicionado a RLS e restringir INSERT/UPDATE/DELETE diretos das tabelas financeiras críticas a papéis administrativos do servidor. Revogar DML de authenticated é uma alternativa; exigir funções SQL transacionais equivalentes seria uma alteração maior. Avaliar payments, payment_allocations, payment_reversals, receivables, receivable_installments, expenses, financial_adjustments e renegotiations, sem aplicar uma lista presumida a outros módulos.

Antes de escrever migration: confirmar os consumidores atuais (web usa API), papéis da conexão Prisma, rotinas de suporte e integrações; verificar se clientes externos dependem de escrita direta. Depois preparar migration aditiva, validar grants/RLS/CRUD da API, pagamentos/estornos/despesas e restore em Supabase descartável. A política de leitura e o isolamento não podem ser abertos para acomodar testes.

Esta proposta não autoriza aplicar SQL, alterar cloud ou fazer publicação. A proteção da API não deve ser removida mesmo se DML direto for revogado.
