# API HTTP

Base local: `http://localhost:3001/v1`. A documentação OpenAPI executável fica em `/v1/docs`; o JSON está em `/v1/docs/openapi.json`.

## Supabase Auth

Login, logout, refresh, convite e recuperação pertencem ao Supabase Auth. A API recebe
`Authorization: Bearer <access_token>` e expõe `GET /auth/me` para retornar profile, membership,
organização e permissões resolvidas. Para múltiplas memberships, `X-Organization-Id` seleciona uma
organização, mas nunca concede acesso sem vínculo ativo. Não existe sessão/CSRF próprio da API.

## Recursos

| Prefixo                         | Operações principais                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `/clients`                      | listar/pesquisar, criar, consultar, editar, arquivar e gerenciar contatos                      |
| `/matters`                      | listar/pesquisar, criar, consultar, editar, arquivar, incluir partes e mover entre etapas      |
| `/pipelines`                    | listar/criar pipelines e configurar etapas                                                     |
| `/finance`                      | contratos, recebíveis/parcelas, pagamentos, estornos, ajustes, renegociações e despesas        |
| `/documents`                    | upload, nova versão, metadados e URL assinada temporária                                       |
| `/work`                         | notas internas, mensagens ao cliente, tarefas/comentários/lembretes e eventos                  |
| `/reports`                      | vencimentos, recebimentos, competência, vencidos, aging, caixa, parciais, contratos e receitas |
| `/reports/:report/export.csv`   | exportação CSV protegida contra fórmula                                                        |
| `/notifications`                | alertas de vencimento, listagem pessoal e marcação de leitura                                  |
| `/admin`                        | usuários, papéis, convites, estados e reconciliação dos papéis de sistema                      |
| `/audit`                        | consulta paginada de auditoria                                                                 |
| `/health/live`, `/health/ready` | processo e conectividade PostgreSQL                                                            |

As rotas exatas, schemas e códigos de resposta devem ser consultados no OpenAPI gerado pelo código.

`GET /v1/notifications/cron` é reservado ao agendador da infraestrutura. A rota exige o Bearer de
`CRON_SECRET`, não aceita sessão de usuário como substituto e reconcilia parcelas e lembretes de
tarefas por destinatário, organização e cliente vinculado.

## Financeiro

`POST /finance/payments` exige `Idempotency-Key` (máximo 160 caracteres). Repetir chave e payload devolve o mesmo pagamento; repetir a chave com conteúdo diferente responde conflito. Valores monetários são strings decimais, por exemplo `"1250.0000"`, nunca números de ponto flutuante.

Pagamento pode ter zero ou várias alocações. A soma não pode ultrapassar o pagamento nem o saldo de uma parcela. Excedente fica como `unappliedAmount`. Estorno usa endpoint próprio e motivo; não existe delete de pagamento confirmado.

## Documentos

Upload usa `multipart/form-data`, arquivo e metadados validados. Tipos aceitos: PDF, DOCX, PNG e JPEG; o tamanho máximo vem de `MAX_DOCUMENT_SIZE_MB`. URLs assinadas expiram em 300 segundos. Usuário com perfil cliente só acessa documento `CLIENT` ligado ao seu próprio `clientId`.

## Relatórios e CSV

Relatórios identificam `basis`: `vencimento`, `recebimento/caixa`, `competência`, `previsão_por_vencimento`, `pagamentos_alocados` ou `estado_contratual`. Períodos usam início inclusivo e fim exclusivo. O exportador CSV adiciona BOM UTF-8, escapa aspas e neutraliza células iniciadas por `=`, `+`, `-`, `@`, tab ou carriage return. `ReportExporter` já reserva a extensão futura para PDF.

## Alertas financeiros

`POST /notifications/reconcile` calcula o saldo efetivo das parcelas com pagamentos confirmados e
ajustes aprovados. Gera notificações `IN_APP` idempotentes para parcelas vencidas ou que vencem em até
sete dias e encerra alertas que deixaram de ter saldo. `GET /notifications` devolve somente as
notificações do usuário autenticado; `PATCH /notifications/:id/read` não permite leitura cruzada entre
usuários ou organizações. Nesta etapa não há envio externo por e-mail ou WhatsApp.

## Erros

Erros seguem o envelope central com status, código/mensagem segura, caminho, timestamp e `requestId`. Stack trace, SQL, URL de banco, tokens e detalhes Prisma não são devolvidos.
