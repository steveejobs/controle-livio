# API HTTP

Base local: `http://localhost:3001/v1`. A documentação OpenAPI executável fica em `/v1/docs`; o JSON está em `/v1/docs/openapi.json`.

## Supabase Auth

Login, logout, refresh, convite e recuperação pertencem ao Supabase Auth. A API recebe
`Authorization: Bearer <access_token>` e expõe `GET /auth/me` para retornar profile, membership,
organização e permissões resolvidas. Para múltiplas memberships, `X-Organization-Id` seleciona uma
organização, mas nunca concede acesso sem vínculo ativo. Não existe sessão/CSRF próprio da API.

## Recursos

| Prefixo                         | Operações principais                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/clients`                      | listar/pesquisar, criar, consultar, editar, arquivar e gerenciar contatos                                                  |
| `/matters`                      | listar/pesquisar, criar, consultar, editar, arquivar, incluir partes e mover entre etapas                                  |
| `/pipelines`                    | listar/criar pipelines e configurar etapas                                                                                 |
| `/finance`                      | contratos, catálogo reutilizável de serviços, recebíveis/parcelas, pagamentos, estornos, ajustes, renegociações e despesas |
| `/documents`                    | upload, modelos preenchidos, configurações do escritório, versões, metadados e URL assinada temporária                     |
| `/work`                         | notas internas, mensagens ao cliente, tarefas/comentários/lembretes e eventos                                              |
| `/reports`                      | vencimentos, recebimentos, competência, vencidos, aging, caixa, parciais, contratos e receitas                             |
| `/reports/:report/export.csv`   | exportação CSV protegida contra fórmula                                                                                    |
| `/notifications`                | alertas de vencimento e audiência, listagem pessoal e marcação de leitura                                                  |
| `/admin`                        | usuários, papéis, convites, estados e reconciliação dos papéis de sistema                                                  |
| `/audit`                        | consulta paginada de auditoria                                                                                             |
| `/health/live`, `/health/ready` | processo e conectividade PostgreSQL                                                                                        |

`GET /clients/:id/overview` agrupa o saldo em aberto por moeda em `financial.outstanding`, com
parcelas, pagamentos confirmados e ajustes aprovados. O resumo só é incluído para quem tem
`receivables:view`; a lista detalhada permanece limitada aos 50 recebíveis mais recentes.

`GET /finance/service-catalog` lista serviços salvos na organização autenticada. `POST` salva um
serviço reutilizável, exige `contracts:create`, impede duplicatas por nome normalizado e registra
auditoria. O contrato recebe a lista marcada em `terms.services`; `service_name` conserva o primeiro
serviço marcado para manter a classificação principal dos relatórios.

`POST /finance/contracts` aceita `hearings` quando o contrato inclui audiência. Cada item informa
`startsAt`, `location` opcional e até oito intervalos `reminderMinutes`; os padrões são 60, 30 e 10
minutos. Sem audiência, envie uma lista vazia ou omita o campo. A API cria o evento `HEARING` na mesma
transação, usa duração padrão de uma hora e programa os alertas internos para quem cadastrou o
contrato. Horários de aviso anteriores à criação não são reprogramados.

`POST /calendar-events` também agenda os alertas padrão quando `type` é `HEARING`; pode receber
`reminderMinutes` para personalizá-los. Ao editar o horário na Agenda, os avisos ainda pendentes são
recalculados. Marcar como realizada/cancelada ou trocar o tipo remove avisos que ainda não foram
enviados.

As rotas exatas, schemas e códigos de resposta devem ser consultados no OpenAPI gerado pelo código.

`GET /v1/notifications/cron` é reservado ao agendador da infraestrutura. A rota exige o Bearer de
`CRON_SECRET`, não aceita sessão de usuário como substituto e reconcilia parcelas e lembretes de
tarefas por destinatário, organização e cliente vinculado.

`GET /v1/notifications/hearing-alerts/cron` usa o mesmo segredo e executa a cada cinco minutos para
publicar os alertas de audiência devidos na central de notificações e enviar push aos dispositivos
inscritos do responsável. O horário agendado é preciso; a entrega pode atrasar até cinco minutos. A
frequência exige Vercel Pro. Alertas futuros não aparecem como lidos/não lidos antes do envio.

## Financeiro

`PATCH /finance/payments/:id/change-requests` registra uma correção proposta com motivo sem alterar o
saldo. `GET /finance/payments/change-requests` exibe a fila administrativa ou as solicitações do autor.
`POST /finance/payments/change-requests/:id/approve` e `/reject` exigem o papel Administrador; quem
solicitou não pode aprovar. A aprovação estorna o lançamento original e cria o pagamento corrigido em
uma transação, mantendo auditoria. O solicitante recebe uma notificação interna do resultado.

`POST /finance/payments` exige `Idempotency-Key` (máximo 160 caracteres). Repetir chave e payload devolve o mesmo pagamento; repetir a chave com conteúdo diferente responde conflito. Valores monetários são strings decimais, por exemplo `"1250.0000"`, nunca números de ponto flutuante.

Pagamento pode ter zero ou várias alocações. A soma não pode ultrapassar o pagamento nem o saldo de uma parcela. Excedente fica como `unappliedAmount`. Estorno usa endpoint próprio e motivo; não existe delete de pagamento confirmado.

## Documentos

Upload usa `multipart/form-data`, arquivo e metadados validados. Tipos aceitos: PDF, DOCX, PNG e JPEG; o tamanho máximo vem de `MAX_DOCUMENT_SIZE_MB`. URLs assinadas expiram em 300 segundos. Usuário com perfil cliente só acessa documento `CLIENT` ligado ao seu próprio `clientId`.

`POST /documents/generate` recebe `clientId`, `category` (`CONTRATO_HONORARIOS`, `PROCURACAO` ou
`HIPOSSUFICIENCIA`) e, para contrato de honorários, `contractId`. Exige `documents:create` e
`clients:view`; o contrato também exige `contracts:view` e `receivables:view`. A API monta um DOCX,
salva a versão como rascunho interno no bucket privado e registra auditoria. Ao gerar de novo o mesmo
modelo para o mesmo cliente/contrato, cria outra versão do documento lógico.

`GET/PATCH /documents/office-settings` é exclusivo do Administrador com `organization:view` ou
`organization:update`, respectivamente. Os dados profissionais ficam em `organizations.settings`, sem
migration; a atualização preserva as demais configurações e a auditoria não replica instruções de
pagamento. Os modelos exigem endereço completo do cliente; para pessoa jurídica, nome e CPF do
representante legal também são necessários.

## Relatórios e CSV

Perfis com `reports:view` podem consultar relatórios. A exportação CSV exige o papel oficial
Administrador, ainda que uma permissão de exportação tenha sido adicionada a um papel personalizado.

Relatórios identificam `basis`: `vencimento`, `recebimento/caixa`, `competência`, `previsão_por_vencimento`, `pagamentos_alocados` ou `estado_contratual`. Períodos usam início inclusivo e fim exclusivo. O exportador CSV adiciona BOM UTF-8, escapa aspas e neutraliza células iniciadas por `=`, `+`, `-`, `@`, tab ou carriage return. `ReportExporter` já reserva a extensão futura para PDF.

## Alertas financeiros

`GET/PATCH /admin/access-alerts` permite que o Administrador configure até cinco horários, em
incrementos de cinco minutos e no fuso da organização. `POST /auth/access` grava o login por sessão;
uma rotina separada consolida os eventos em notificações internas. O cron
`GET /notifications/access-alerts/cron` é protegido por `CRON_SECRET` e está configurado para executar
a cada cinco minutos. Essa frequência exige Vercel Pro; no plano Hobby cada cron pode rodar somente uma
vez por dia.

`POST /notifications/reconcile` calcula o saldo efetivo das parcelas com pagamentos confirmados e
ajustes aprovados. Gera notificações `IN_APP` idempotentes para parcelas vencidas ou que vencem em até
sete dias e encerra alertas que deixaram de ter saldo. `GET /notifications` devolve somente as
notificações do usuário autenticado; `PATCH /notifications/:id/read` não permite leitura cruzada entre
usuários ou organizações. Nesta etapa não há envio externo por e-mail ou WhatsApp.

## Erros

Erros seguem o envelope central com status, código/mensagem segura, caminho, timestamp e `requestId`. Stack trace, SQL, URL de banco, tokens e detalhes Prisma não são devolvidos.

## Push notifications

`GET /notifications/push/config` returns the public VAPID key and the current user's device subscriptions. `POST /notifications/push-subscriptions` registers the browser endpoint; `DELETE` on the same route removes it. These routes require `notifications:update` and are scoped to the authenticated organization/user. Push is sent only when all VAPID settings are present. Browser permission is granted separately on each device.

## Modelos editáveis

`GET /documents/templates` devolve os três textos padrão ou personalizados e a lista de variáveis
disponíveis, com nome, explicação e exemplo. `PATCH /documents/templates` recebe `category` e
`content`; bloqueia variáveis desconhecidas/incompletas e a remoção dos dados essenciais de cada
documento. `DELETE /documents/templates/:category` restaura somente aquele texto padrão. Essas rotas
exigem papel oficial Administrador e `organization:view`/`organization:update`. O texto é salvo em
`organizations.settings.legalDocuments.templates`; altera novas emissões, sem regravar versões já
emitidas.

## Atividades administrativas

`GET /audit-logs` combina alterações auditadas, acessos ao sistema e abertura de módulos/fichas.
Aceita `page`, `pageSize`, `category` (`all`, `changes`, `access`, `navigation`), `actorUserId`,
`search`, `dateFrom` e `dateTo`. `GET /audit-logs/actors` fornece os usuários da organização para o
filtro. As duas consultas exigem o papel oficial Administrador e `audit:view`; o retorno traduz a
ação e os campos alterados, sem expor valores anteriores/posteriores.

`POST /audit-logs/module-views` registra a abertura de uma área depois de conferir a permissão
correspondente. `POST /audit-logs/client-views` registra a ficha aberta depois de conferir
`clients:view` e o escopo da organização/cliente. Ambos usam a organização da sessão autenticada.
