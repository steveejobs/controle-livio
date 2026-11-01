# Telas e fluxos

## Rotas web encontradas

| URL                      | Tipo               | Perfil e finalidade                                                                                                                        | Estado                                                                          |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| /                        | Página principal   | Sessão autenticada; login e shell multiárea com portal para papel cliente.                                                                 | IDENTIFICADO NO CÓDIGO; Playwright mockado cobre os fluxos descritos em TESTES. |
| /reset-password          | Página             | Define nova senha após sessão/link de recuperação válido; orienta cliente profissional a pedir link ao administrador se e-mail não chegar. | IDENTIFICADO NO CÓDIGO; callback remoto e envio de e-mail não foram repetidos.  |
| /auth/confirm            | Route handler      | Confirma sessão/código Supabase e redireciona; associado ao fluxo de recuperação/invite.                                                   | IDENTIFICADO NO CÓDIGO; não foi exercitado diretamente nesta execução.          |
| /assinar/[token]         | Página pública     | Visualiza documento e coleta consentimento/assinatura por bearer token.                                                                    | IDENTIFICADO NO CÓDIGO; E2E usa API mockada, não prova token real.              |
| /manifest.webmanifest    | Recurso estático   | Metadados PWA.                                                                                                                             | IDENTIFICADO NO CÓDIGO.                                                         |
| /sw.js e /pwa-install.js | Recursos estáticos | Push/click e instalação PWA.                                                                                                               | IDENTIFICADO NO CÓDIGO; browser/OS real não verificado.                         |

Não foram encontradas rotas Next dedicadas aos 16 módulos. Esses módulos são estados/abas dentro da página principal, sem deep link permanente. A shell e permissões podem ocultar áreas, mas proteção real permanece no backend.

## As 16 áreas da shell

| Tela ID | Área            | Ações/dados observados                                                                         | Entradas/saídas                                                                               |
| ------- | --------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| T01     | Portal          | Visão do cliente vinculado, documentos visíveis e mensagens ao escritório.                     | Sessão com papel cliente; saída por mensagem ou navegação principal.                          |
| T02     | Dashboard       | Indicadores e gráficos resumidos por período, atalhos para módulos.                            | /dashboard/summary; atalhos para clientes/processos/financeiro.                               |
| T03     | Clientes        | Busca/lista, cadastro guiado, detalhe, contatos, foto, OCR e WhatsApp.                         | Ficha abre processo/financeiro/documento; detalhes em painel/modal.                           |
| T04     | Processos       | Lista e pipeline jurídico, criação/edição/arquivamento, linha do tempo, partes e movimentação. | Relaciona clientes, tarefas, agenda, mensagens, contratos e docs.                             |
| T05     | CRM jurídico    | Pipeline e estágios do funil processual.                                                       | Cria/edita pipelines; abre processo/cliente.                                                  |
| T06     | CRM de cobrança | Visão de carteira e pendências relacionadas a cobrança.                                        | Liga recebíveis e cliente; ações financeiras sujeitas a permissões.                           |
| T07     | Documentos      | Upload, listagem, versões, geração, download e assinatura.                                     | Recebe cliente/processo/contrato; configurações são administrativas.                          |
| T08     | Tarefas         | Lista, criação/edição, comentários e lembretes.                                                | Relaciona cliente/processo e alimenta notificações.                                           |
| T09     | Calendário      | Eventos/audiências/prazos, edição de horários/status e lembretes.                              | Pode ligar cliente/processo; lembretes dependem do scheduler.                                 |
| T10     | Notificações    | Lista, marcar como lida, reconciliar e configurar push.                                        | Dados da organização/membro; push depende de VAPID/browser.                                   |
| T11     | Contratos       | Cadastro de honorários/serviços e consulta.                                                    | Alimenta recebíveis/documentos.                                                               |
| T12     | Financeiro      | Recebíveis, parcelas, pagamentos, ajustes, despesas, reversões e decisões.                     | Permissões financeiras e, para decisões específicas, administrador.                           |
| T13     | Relatórios      | 12 visões e exportação CSV.                                                                    | Filtros/períodos; dados financeiros derivados.                                                |
| T14     | Administração   | Usuários, estado, recuperação, papéis e alertas de acesso.                                     | Administração de organização e papéis; sem interface completa para toda gestão de membership. |
| T15     | Pipelines       | Gestão de pipeline/estágios.                                                                   | Compartilhado com CRM e processos.                                                            |
| T16     | Auditoria       | Consulta de atores, eventos e visualizações.                                                   | Restrita por permissão; parte da trilha é registrada automaticamente.                         |

Referência detalhada: IDs F01–F30 em 03-INVENTARIO_FUNCIONAL.md.

## Estados e validação de interface

As áreas usam componentes compartilhados de carregamento/erro e cache API; formulários HTML/React usam campos obrigatórios e schemas Zod correspondentes no servidor. Em formulários financeiros, valores são strings e formatação pt-BR evita converter dinheiro para ponto flutuante de negócio. A tela tem estados de carregamento e erro em hooks/áreas principais; comportamento visual foi exercitado por Playwright mockado.

A suíte E2E verificou parte da acessibilidade e overflow em 360 e 1440 pixels e cenários de sucesso com mocks. Isto é evidência de UI sob os fixtures da suíte, não de todos os estados em API real. Mensagens de erro reais, respostas lentas, dados extensos e erros de Storage continuam sem confirmação.

## Jornadas do usuário

1. **Entrada da equipe:** provisionamento inicial por operador; administrador cria/ativa usuário ou gera link de recuperação; membro autentica; API resolve membership e permissões; shell mostra áreas habilitadas. O provisionamento inicial e entrega de e-mail dependem de configuração externa.
2. **Atendimento:** localizar/criar cliente → revisar dados e contatos → opcionalmente OCR local → adicionar foto/documento → abrir pipeline/processo → cadastrar partes, contrato, tarefa e eventos.
3. **Contrato e cobrança:** selecionar serviço → criar contrato → criar recebível/parcelas → registrar pagamento/alocação → corrigir por pedido aprovado/reversão se necessário → acompanhar dashboards/relatórios/notificações.
4. **Documento e assinatura:** gerar ou carregar arquivo privado → revisar versão → emitir pedido com link → cliente abre tela pública → lê, consente e assina → API cria evidência PDF e nova versão vinculada.
5. **Portal:** cliente autenticado consulta somente vínculo e materiais visíveis e envia mensagem; não vê notas internas.
6. **Prazos e alertas:** criar audiência/tarefa → configurar lembretes → scheduler grava/dispara notificação → browser opcionalmente recebe push.

## Usabilidade e inconsistências observáveis

- Módulos sem URL própria dificultam compartilhar/reabrir um estado específico.
- CRM jurídico, Processos e Pipelines são superfícies relacionadas e podem duplicar localização mental.
- Administração de organizações múltiplas não é descoberta pela shell; seleção da organização é uma lacuna funcional observada no código cliente/API.
- Recorrência de calendário aparece e persiste, mas não há evidência de expansão de ocorrências.
- Links WhatsApp/e-mail apenas transferem o usuário ao aplicativo externo; não devem ser apresentados como envio confirmado.
- Protótipo de dashboard legado com dados estáticos poderia induzir interpretação errada caso reativado.
