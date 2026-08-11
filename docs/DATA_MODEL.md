# Modelo de dados

## Convenções e tenant

Tabelas/colunas físicas usam `snake_case`; Prisma usa `camelCase`. IDs são UUID, instantes são `timestamptz(3)`, datas contábeis são `date` e dinheiro é `decimal(19,4)`. Toda entidade de negócio contém `organization_id`; somente `organizations` é a raiz sem esse campo.

Além das foreign keys, triggers comparam o `organization_id` de cada referência com o registro filho, incluindo usuários responsáveis e atores. Assim uma relação cruzada é rejeitada mesmo se um erro futuro esquecer um filtro na aplicação.

## Identidade e CRM

- `auth.users` e `profiles` formam a identidade global; `organization_members`,
  `organization_member_roles`, `roles`, `permissions` e `role_permissions` formam membership e RBAC.
  `users` permanece como identidade operacional por organização para compatibilidade com as FKs do
  domínio. `sessions` e `password_reset_tokens` são legado inativo, não autenticação paralela.
- `clients` mantém CPF/CNPJ normalizado; `client_contacts` guarda contatos. Um usuário cliente aponta para um único cliente do mesmo tenant.
- `matters` contém prioridade, responsáveis jurídico/secretaria, próxima ação, etiquetas, origem/perda e número processual normalizado.
- `pipelines` e `pipeline_stages` configuram Comercial, Jurídico e Cobrança. `matter_stage_history` é imutável.

## Financeiro

`contracts` define serviço e honorários. `receivables` representa o título e `receivable_installments` suas parcelas. Uma parcela recebe muitas alocações e um pagamento se distribui entre muitas parcelas por `payment_allocations`.

Saldo da parcela = valor original + juros/multa/correção/outros − descontos/reversões − alocações ativas de pagamentos confirmados. A aplicação usa Decimal e trava parcelas antes de validar/alocar. Valor excedente permanece não alocado no pagamento; saldo de parcela nunca fica negativo.

`financial_adjustments` aponta exatamente para uma parcela ou pagamento. `payment_reversals` registra estorno sem apagar o pagamento; alocações ganham `reversed_at/reversed_by_id`. `renegotiations` liga o recebível original cancelado ao novo, cuja soma deve ser exatamente o saldo renegociado. `expenses` registra saídas separadas.

Relatórios distinguem vencimento, recebimento/caixa e competência. Receita por advogado/serviço deriva de alocações confirmadas, não do estado visual de pipeline.

## Documentos, comunicação e trabalho

`documents` é o objeto lógico e pode vincular cliente, processo, parcela ou pagamento. `document_versions` é append-only e guarda metadados do objeto privado, nunca binário.

`internal_notes` e `client_messages` são tabelas distintas: conteúdo interno não pode ser publicado pela troca de um flag. Tarefas usam `tasks`, `task_comments`, `task_reminders` e `task_history`; agenda usa `calendar_events` com tipo audiência, reunião, prazo jurídico ou outro e recorrência básica.

`notifications`, `audit_logs` e `activity_events` suportam entrega, evidência técnica e linha do tempo. Auditoria, histórico de etapas/tarefas, versões e estornos são protegidos contra update/delete no banco.
