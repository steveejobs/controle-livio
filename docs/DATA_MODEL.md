# Modelo de dados

## Convenções e tenant

Tabelas/colunas físicas usam `snake_case`; Prisma usa `camelCase`. IDs são UUID, instantes são `timestamptz(3)`, datas contábeis são `date` e dinheiro é `decimal(19,4)`. Toda entidade de negócio contém `organization_id`; somente `organizations` é a raiz sem esse campo.

Além das foreign keys, triggers comparam o `organization_id` de cada referência com o registro filho, incluindo usuários responsáveis e atores. Assim uma relação cruzada é rejeitada mesmo se um erro futuro esquecer um filtro na aplicação.

## Identidade e CRM

- `auth.users` e `profiles` formam a identidade global; `organization_members`,
  `organization_member_roles`, `roles`, `permissions` e `role_permissions` formam membership e RBAC.
  `users` permanece como identidade operacional por organização para compatibilidade com as FKs do
  domínio. `sessions` e `password_reset_tokens` são legado inativo, não autenticação paralela.
- `clients` mantém CPF/CNPJ normalizado; `client_contacts` guarda contatos. Qualificação civil e representante legal para geração documental ficam nas chaves estruturadas `clients.custom_fields.legalIdentity` e `clients.custom_fields.legalRepresentative`, usando a coluna JSON já existente. Um usuário cliente aponta para um único cliente do mesmo tenant.
- `matters` contém prioridade, responsáveis jurídico/secretaria, próxima ação, etiquetas, origem/perda e número processual normalizado. Em cobranças, `custom_fields.collectionObjective` guarda a descrição de um objetivo explicitamente marcado como sem valor financeiro; isso não altera o ledger.
- `pipelines` e `pipeline_stages` configuram Comercial, Jurídico e Cobrança. `matter_stage_history` é imutável.

## Financeiro

`payment_change_requests` guarda a proposta de correção de um pagamento confirmado, o motivo, o autor e
a decisão do Administrador. A aprovação não reescreve o lançamento original: registra estorno, aponta
o substituto nos metadados e cria o pagamento corrigido. `activity_events` também armazena `SYSTEM_ACCESS`
por sessão; esses eventos são imutáveis e usados para formar os resumos de acesso.

`contracts` define honorários, a classificação principal `service_name` e a lista selecionada em `terms.services`. `service_catalog_items` guarda serviços reutilizáveis por organização, com área e nome normalizado para evitar duplicatas. `receivables` representa o título e `receivable_installments` suas parcelas. Uma parcela recebe muitas alocações e um pagamento se distribui entre muitas parcelas por `payment_allocations`.

Saldo da parcela = valor original + juros/multa/correção/outros − descontos/reversões − alocações ativas de pagamentos confirmados. A aplicação usa Decimal e trava parcelas antes de validar/alocar. Valor excedente permanece não alocado no pagamento; saldo de parcela nunca fica negativo.

`financial_adjustments` aponta exatamente para uma parcela ou pagamento. `payment_reversals` registra estorno sem apagar o pagamento; alocações ganham `reversed_at/reversed_by_id`. `renegotiations` liga o recebível original cancelado ao novo, cuja soma deve ser exatamente o saldo renegociado. `expenses` registra saídas separadas.

Relatórios distinguem vencimento, recebimento/caixa e competência. Receita por advogado/serviço deriva de alocações confirmadas, não do estado visual de pipeline.

## Documentos, comunicação e trabalho

`documents` é o objeto lógico e pode vincular cliente, processo, parcela ou pagamento. `document_versions` é append-only e guarda metadados do objeto privado, nunca binário.

Os modelos de contrato, procuração e hipossuficiência geram DOCX como rascunhos internos. Nova emissão
atualiza o documento lógico criando outra linha em `document_versions`. Dados profissionais usados no
cabeçalho e assinatura são isolados em `organizations.settings.legalDocuments`; não exigem nova coluna
nem migration.

`internal_notes` e `client_messages` são tabelas distintas: conteúdo interno não pode ser publicado pela troca de um flag. Tarefas usam `tasks`, `task_comments`, `task_reminders` e `task_history`; agenda usa `calendar_events` com tipo audiência, reunião, prazo jurídico ou outro e recorrência básica. Avisos de audiência programados ficam em `notifications` com `scheduled_at` e metadados do evento/intervalo; não exigem tabela ou migration adicional.

`notifications`, `audit_logs` e `activity_events` suportam entrega, evidência técnica e linha do tempo. Auditoria, histórico de etapas/tarefas, versões e estornos são protegidos contra update/delete no banco.

## Browser push

`web_push_subscriptions` stores one browser endpoint with its organization and user owner. Endpoints are unique, encryption keys stay in the API database, RLS is enabled without browser policies, and a tenant trigger rejects subscriptions linked to another organization's user.
