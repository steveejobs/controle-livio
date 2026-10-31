# Validação operacional e plano

**Data:** 2026-10-27  
**Objetivo:** avaliar as seis jornadas de escritório solicitadas, distinguindo implementação em código de integração realmente exercitada.  
**Escopo:** checkout local nesta branch e um ensaio QA integrado, condicionado pelos guardrails existentes. Não houve deploy, migration, alteração de código ou uso de dados de cliente.

## Resumo executivo

O repositório oferece os principais blocos para iniciar atendimento jurídico e receber honorários. Nesta validação, Auth Supabase, criação de cliente, isolamento básico entre organizações, Storage de foto, catálogo, recebível parcelado, igualdade da soma das parcelas, contrato e audiência foram exercitados contra serviços reais em projeto Supabase declarado como desenvolvimento.

O ensaio foi interrompido na etapa documental por uma asserção desatualizada do próprio verificador. A API gerou o documento e a URL assinada respondeu HTTP 200, mas o teste esperava DOCX como arquivo atual; a implementação grava DOCX e depois PDF, portanto a versão atual esperada é PDF. Não se classifica isso como falha funcional comprovada do produto. O script não chegou às verificações posteriores de pagamento, portal, relatório e reconciliação de alertas.

As seis jornadas ficam como **PARCIAL** na classificação operacional: algumas etapas têm evidência real, mas nenhuma jornada completa foi validada de ponta a ponta nesta execução. Despesas não têm fluxo de aprovação/pagamento, recorrência do calendário não gera ocorrências e os fluxos reais de upload documental, assinatura, tarefas e portal continuam sem prova nesta rodada.

## 1. Estado de referência

| Item                             | Estado observado                                                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch                           | main                                                                                                                                                                                                                                                          |
| HEAD                             | 919a5accc91bc96dbd87773411668d017f968e35                                                                                                                                                                                                                      |
| Alterações rastreadas locais     | 81 arquivos, contagem igual ao snapshot anotado na auditoria                                                                                                                                                                                                  |
| Itens não rastreados             | 48 entradas; 47 já existiam no snapshot da auditoria e a entrada adicional é o diretório de auditoria                                                                                                                                                         |
| Mudanças desta etapa             | Este documento e o registro correspondente no PROJECT_CONTEXT.md; build gerou artefatos ignorados. Nenhum arquivo de aplicação foi alterado.                                                                                                                  |
| Configuração                     | Um .env na raiz; não foram encontrados .env.local ou arquivos de ambiente separados em apps/api e apps/web. Nenhum valor secreto foi impresso.                                                                                                                |
| Variáveis de ambiente relevantes | SUPABASE_ENVIRONMENT=development, NODE_ENV=development, SUPABASE_LOCAL=false. SUPABASE_PROJECT_REF está presente e coincide com CONFIRM_SUPABASE_PROJECT_REF. O endpoint Supabase e DATABASE_URL são remotos; a aplicação não está apontada a um banco local. |
| API configurada                  | NEXT_PUBLIC_API_URL aponta para alvo local. O ensaio usou a API local compilada na porta 3021 com o banco/Auth/Storage Supabase remoto de desenvolvimento.                                                                                                    |
| Isolamento local                 | Docker CLI e Supabase CLI não estão disponíveis; não foi possível subir uma stack Supabase local.                                                                                                                                                             |
| Variáveis QA                     | QA_API_URL e QA_ORG_SLUG não estavam configuradas. O script verify-workflows.ts aceita --local-api; QA_ALLOW_WRITES e QA_PROJECT_REF foram definidos apenas no processo do ensaio para satisfazer seus guardrails.                                            |

### Ambiente que pode ser usado e ambientes protegidos

O projeto configurado localmente se identifica como development e a confirmação explícita do project ref coincide. O DATABASE_URL também é verificado pelo script QA para pertencer ao mesmo projeto. O teste integrado criou tenants e identidades fictícias com sufixos únicos, sem selecionar uma organização de cliente.

Esse é um projeto remoto, não uma instância local descartável. O rótulo development e a confirmação de ref são os indícios disponíveis; a auditoria não comparou o identificador remoto com credenciais de produção, que não foram carregadas. Portanto, não declarar isolamento físico ou de propriedade do projeto como prova independente. O fluxo QA habilita escrita apenas com QA_ALLOW_WRITES=true, projeto correspondente a SUPABASE_PROJECT_REF e CONFIRM_SUPABASE_PROJECT_REF e banco/URL pertencentes ao mesmo alvo. O uso observado também foi limitado a organizações sintéticas.

O modo production é protegido pelos guardrails de ferramentas de migração/bootstrap e não foi usado. Não foram carregadas credenciais de produção. A política segura para a continuidade é exigir um projeto Supabase DEV/TEST separado e confirmado, nunca usar dados reais e manter a escrita QA atrás dos mesmos checks.

### Comparação com o snapshot da auditoria

A auditoria anterior registrou 81 arquivos rastreados modificados e 47 não rastreados antes de criar seus documentos. O estado atual continua com 81 arquivos rastreados alterados e 48 entradas não rastreadas; a diferença observável corresponde ao diretório de auditoria já criado. Não há baseline de hash por arquivo, então não é possível provar identidade byte a byte do código desde o snapshot. O checkout continua sujo e nenhuma alteração preexistente foi sobrescrita ou descartada.

## 2. Resultado real do ensaio QA

Comando funcional usado: build da API e tools/qa/verify-workflows.ts com --local-api. A API foi compilada do checkout atual. O script cria dois escritórios fictícios, membros Supabase Auth e registros sintéticos; ao finalizar, suspende memberships, arquiva apenas as organizações do run e bane as identidades de teste. Ele retém histórico e arquivos de evidência no Supabase e grava relatório/log locais ignorados pelo Git.

| Check executado antes da interrupção                                                                   | Resultado                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Login Supabase, vínculo ativo, organização e permissões                                                | PASSOU; consulta real de Auth/API/Prisma                                                                                                        |
| Convite de profissional por link e redefinição de senha                                                | PASSOU; link consumido no Auth, sem envio de e-mail                                                                                             |
| Cadastro PF/PJ, CPF inválido, documento duplicado e barreiras entre dois tenants                       | PASSOU; asserções reais de API e persistência                                                                                                   |
| Foto privada: upload, signed URL, leitura, remoção, arquivo inválido e tenant externo                  | PASSOU em Auth/API/Storage                                                                                                                      |
| Catálogo, recebível de R$ 1.000,00 em três parcelas, contrato vinculado e audiência com três lembretes | PASSOU; o script conferiu valores/persistência/reminders por API e Prisma                                                                       |
| Geração documental e download assinado                                                                 | Resposta da geração e GET do arquivo retornaram; falhou a asserção de assinatura de arquivo: observado PDF, esperado magic ZIP/DOCX pelo script |
| Checks posteriores de pagamento, portal/RLS, exportação e reconciliação                                | NÃO EXECUTADOS: o script abortou no check documental                                                                                            |

O relatório QA local registra success=false, stage documentos e Storage privado, cinco checks concluídos e duas organizações sintéticas. O finalizador do próprio script foi executado; ele arquiva/suspende tenants e bane os usuários de teste. O script não apaga histórico nem os arquivos gerados. O relatório está em test-results/qa-workflows-1793125781741-7c7464.json; não copiar IDs, e-mails, tokens ou conteúdo do log para documentos compartilháveis.

PROJECT_CONTEXT.md também menciona um relatório QA anterior, mas esse arquivo histórico não está presente neste checkout; por isso não foi usado como resultado reproduzido nesta validação.

Falha de verificação confirmada: tools/qa/verify-workflows.ts espera 504b0304 para a versão obtida por download-url. DocumentsService.generate cria primeiro DOCX e depois cria uma versão PDF; a versão atual é PDF, cuja assinatura observada foi 25504446. O arquivo veio da URL assinada com HTTP 200. A asserção está desalinhada com a ordem atual das versões. A execução não chegou à conferência de SHA-256 após essa asserção, portanto integridade criptográfica do download não foi comprovada neste run.

O ensaio real é mais forte que os 21 cenários E2E mockados da auditoria, mas cobre somente os checks acima. Testes Playwright anteriores continuam sendo evidência de UI simulada, não validação de integração.

## 3. Matriz das seis jornadas

| Jornada                      | Interface                                               | Cobertura real desta execução                                                                                                                          | Lacuna decisiva                                                                                                           | Resultado   |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------- |
| A — Cadastro até processo    | Login/administração, Clientes, Processos/CRM jurídico   | Auth, membership, cliente PF/PJ e isolamento de cliente testados; outras etapas têm código                                                             | Provisionamento de escritório é externo; contato, matter, responsáveis e mudança de estágio não foram executados          | **PARCIAL** |
| B — Contrato até recebimento | Clientes, Contratos, Recebíveis, Financeiro, Relatórios | Serviço, parcelas que somam exatamente o recebível, contrato vinculado e audiência testados; pagamento/idempotência/saldo têm código e testes mockados | Ensaio real parou antes do pagamento e relatórios; isolamento financeiro e concorrência não foram exercitados             | **PARCIAL** |
| C — Despesas                 | Financeiro/Despesas                                     | Criação e consulta identificadas no código                                                                                                             | Aprovação, pagamento, transição de status e inclusão em previsões não têm operações correspondentes                       | **PARCIAL** |
| D — Documentos               | Documentos, ficha do cliente, assinatura pública        | Geração de documento e download via URL assinada iniciados; GET do arquivo respondeu HTTP 200                                                          | Verificador espera tipo antigo; upload/versionamento/compartilhamento/assinatura e hash do download não concluídos no run | **PARCIAL** |
| E — Tarefas e prazos         | Tarefas, Agenda, Notificações                           | Audiência e criação de lembretes decorrentes de contrato testadas                                                                                      | Tarefa, responsável, conclusão, histórico, recorrência real e dispatch agendado não testados                              | **PARCIAL** |
| F — Portal do cliente        | Minha área / ClientPortal                               | Código filtra dados por clientId e permissões; E2E anterior é mockado                                                                                  | Teste integrado de cliente, RLS de portal, mensagens e notificações não foi alcançado após falha em D                     | **PARCIAL** |

Nenhuma jornada recebeu FUNCIONAL porque nenhuma completou todas as etapas do início ao fim. Nenhuma falha operacional do produto foi reproduzida para justificar NÃO FUNCIONAL. Os trechos sem teste real são identificados abaixo como NÃO VERIFICADOS.

## 4. Detalhamento das jornadas

### Jornada A — Cadastro até processo

**Interface e início.** Entrada em apps/web/features/app/legal-crm.tsx; cadastro/ficha em apps/web/features/clients/client-management.tsx e client-detail.tsx; board em apps/web/features/matters/matter-board.tsx; administração em apps/web/features/admin/team-management.tsx. A criação inicial da organização não é uma etapa da UI: bootstrap/admin depende de provisionamento fora da jornada do cliente.

**Rotas.** GET /auth/me; GET/POST/PATCH /clients; POST /clients/:clientId/contacts; GET/POST /matters; PATCH /matters/:id; POST /matters/:id/stage-movements; GET /pipelines. Auth de usuário/membership é Supabase. Não há endpoint de criação self-service de organização identificado.

**Entidades.** Organization, Profile, User, OrganizationMember, Role, Permission, Client, ClientContact, Pipeline, PipelineStage, Matter, MatterStageHistory e AuditLog.

**Regras e permissões.** Cliente exige type PERSON/COMPANY e nome de 2–200 caracteres; valida e normaliza CPF/CNPJ e impede duplicidade na persistência. Contato exige nome e aceita papel, e-mail/telefone e principal. Processo exige cliente ativo; referência, título, status/priority e relações são validados. Responsáveis advogado/secretaria precisam ser usuários ativos da mesma organização. Status é alterado via PATCH; etapa do pipeline tem operação separada, exige estágio ativo no pipeline do processo e grava histórico. Permissões principais: clients:create/update, matters:create/update, pipelines:view; status de equipe e papel exige users:manage/roles:manage e administrador.

**Integrações.** Supabase Auth e PostgreSQL/Prisma. O guard exige organização selecionada quando há mais de uma membership; o seletor de organização não foi localizado na web.

**Evidência.** O ensaio confirmou login real, vínculo/organização, convite e recuperação; criou clientes PF/PJ via API, rejeitou CPF inválido e documento duplicado, e confirmou 404 entre tenants. Não chamou a API de contato nem criou/moveu processo. Esses passos estão identificados no código, mas NÃO VERIFICADOS operacionalmente.

**Dependências e conclusão.** Provisionar organização/primeiro admin; disponibilizar seletor ou restringir formalmente a uma organização; depois validar contato, processo, responsável, atualização de status e histórico em QA com dois tenants.

### Jornada B — Contrato até recebimento

**Interface.** Seleção de serviço/contrato em apps/web/features/finance/service-selection.tsx e contracts.tsx; operação financeira em finance-operations.tsx; resultados em relatórios e dashboard.

**Rotas.** GET/POST /finance/service-catalog; POST /finance/contracts; POST /finance/receivables; GET /finance/receivables e /finance/receivables/:id; POST /finance/payments com Idempotency-Key; GET /finance/payments; relatórios GET /reports/receivables-due, /received, /accrual, /overdue, /aging, /cash-forecast, /partial-payments, /active-contracts, /revenue-by-lawyer, /revenue-by-service, /delinquent-clients e /reconciliation.

**Entidades.** Client, ServiceCatalogItem, Contract, Receivable, ReceivableInstallment, Payment, PaymentAllocation, PaymentReversal, PaymentChangeRequest, FinancialAdjustment, Renegotiation, CalendarEvent, Notification e AuditLog.

**Regras e permissões.** Dinheiro chega como string decimal com até quatro casas e é persistido Decimal(19,4). O total das parcelas deve ser exatamente igual ao recebível e sequências não podem duplicar. Pagamentos alocam no máximo o saldo disponível, na mesma moeda/cliente, e não aceitam parcelas canceladas/renegociadas. Idempotency-Key repetida com mesmo payload devolve o pagamento existente; payload diferente conflita. Transação é serializável. Contrato pode vincular recebível sem duplicar vínculo; se houver valor fixo, deve coincidir com o valor do recebível. Finance cria serviço/contrato/recebível/pagamento; decisão de mudança/reversão exige payments:approve e administrador. Relatórios usam reports:view; CSV exige reports:export e administrador.

**Evidência.** API real criou serviço, três parcelas de 333,33 + 333,33 + 333,34, recebível de 1.000,00, contrato fixo vinculado e audiência. O teste direto conferiu vínculo e lembretes. O script não chegou a registrar pagamento. Um teste Playwright anterior simula UI financeira, mas não substitui esse passo real. Pagamento, idempotência, aprovação e saldo exato estão cobertos por código/unit e pelo histórico anterior, porém NÃO VERIFICADOS nesta rodada integrada.

**Falhas/lacunas.** Nenhum endpoint de gateway ou conciliação bancária automática. Relatórios de receita são permissionados, porém sem consulta real nesta execução. Isolamento de cliente/arquivo foi testado; isolamento financeiro por payment/receivable entre tenants e corrida de pagamentos simultâneos continuam NÃO VERIFICADOS.

**Dependências.** Prosseguir com uma nova execução QA depois de corrigir o teste de documento ou separar cenários. Incluir registro de pagamento, repetição de chave, rejeição de chave com payload distinto, aprovação por admin, consulta do saldo e leitura dos relatórios no mesmo tenant; repetir tentativa cruzada em tenant externo.

### Jornada C — Despesas

**Interface e rotas.** Financeiro/Despesas em apps/web/features/finance/finance-operations.tsx. POST /finance/expenses e GET /finance/expenses. Permissões expenses:create e expenses:view.

**Entidades e validação.** Expense possui status DRAFT, PENDING_APPROVAL, APPROVED, PAID, CANCELLED; Decimal(19,4), description, category, incurredAt, dueDate opcional, paidAt, reimbursable, approvedById/approvedAt, vínculo opcional com client/matter e documentos. POST valida descrição, categoria, amount string, moeda e data de ocorrência; confirma vínculos na organização e grava Expense + AuditLog. A listagem pagina e filtra cliente/status.

**Etapas ausentes confirmadas.** Não há PATCH/POST para submeter, aprovar, rejeitar, pagar, cancelar ou atualizar vencimento. Portanto os estados do enum não têm transições de negócio expostas. Não foi encontrada inclusão de Expense no cash forecast: reports service calcula previsão por saldo de parcelas a receber. Não houve criação real de despesa nesta execução.

**Integrações, riscos e decisão.** Não há gateway/banco envolvido. A ausência é PARCIAL e estrutural. O produto precisa decidir se despesa é fluxo de aprovação/pagamento ou simples registro de custo; depois fechar transições, permissões de aprovador, documentos comprovantes, reflexo em fluxo de caixa e auditoria. Arquivos: finance.schemas.ts, finance.controller.ts, finance.service.ts, finance-operations.tsx, schema Prisma Expense e reports.service.ts.

### Jornada D — Documentos

**Interface e rotas.** apps/web/features/documents/documents.tsx, documents editor/config e client-detail.tsx; assinatura pública em /assinar/[token]. Rotas POST /documents/generate, POST /documents, POST /documents/:id/versions, GET /documents, GET /documents/:id/download-url, POST /documents/:id/signature-requests, POST /documents/signature-requests/:id/revoke, GET/POST /public/signatures/:token.

**Entidades e regras.** Document, DocumentVersion, DocumentSigningRequest e Storage privado. Upload associa metadados opcionais a cliente/processo/contrato/financeiro, valida o vínculo na organização, grava hash e versão e retorna URL assinada de curta duração. Atualizar versão serializa o contador e revoga pedidos pendentes de assinatura da versão anterior. Gerador atual cria DOCX e em seguida PDF; PDF é a versão atual. Assinatura pública requer nome correspondente, consentimento e imagem/nome digitado, cria evidências/hash e PDF assinado; validade de 1–30 dias, token guardado como hash. É assinatura eletrônica simples do fluxo atual, não prova de identidade qualificada.

**Permissões/integrações.** documents:create para gerar/upload/pedir assinatura; documents:update para versões/revogação; documents:view para listar/download; configuração/modelos exigem administrador. Depende de Supabase Storage, PDFs e link manual; e-mail/WhatsApp não têm envio confirmado. RLS e bucket remoto precisam ser confirmados.

**Evidência e falha do teste.** O QA atualizou configuração do escritório, chamou geração de documento e obteve URL assinada; GET do download respondeu HTTP 200 e o payload começa com assinatura PDF, compatível com a versão atual do código. A suíte QA esperava DOCX/PK, falhou antes do hash e interrompeu o restante do teste. Assim, geração/download tiveram evidência parcial real; upload genérico, nova versão, assinatura, revogação, hash do download e histórico da assinatura continuam NÃO VERIFICADOS.

**Correção necessária ao plano de QA.** tools/qa/verify-workflows.ts deve testar a assinatura da versão atual como PDF e, se precisar validar o DOCX, solicitar explicitamente versão anterior; em seguida comparar o SHA-256 da versão baixada ao valor persistido. Essa correção é do teste e não foi aplicada nesta missão. O endpoint público também precisa redigir o token bearer de URL/log/erro conforme risco já documentado em 07-SEGURANCA_E_PERMISSOES.md.

### Jornada E — Tarefas e prazos

**Interface e rotas.** apps/web/features/work/tasks.tsx, calendar.tsx e notifications-center.tsx. POST/GET /tasks; PATCH /tasks/:id; POST /tasks/:id/comments; POST /tasks/:id/reminders; POST/GET /calendar-events; PATCH /calendar-events/:id; GET/PATCH /notifications e POST /notifications/reconcile.

**Entidades e regras.** Task, TaskComment, TaskReminder, TaskHistory, CalendarEvent, Notification, ScheduledJobState. Task aceita título, estado OPEN/IN_PROGRESS/BLOCKED/COMPLETED/CANCELLED, priority, responsável opcional, vencimento e vínculos. Ao concluir grava completedAt; criação/atualização geram TaskHistory. Calendar valida timezone, end > start, tipo e intervalo de reminder; audiência gera Notification programada em transação e alteração/cancelamento sincroniza lembretes pendentes.

**Recorrência e automação.** recurrenceRule aceita DAILY/WEEKLY/MONTHLY com intervalo/contagem limitada, é persistida e exibida. Não foi encontrada expansão em novas ocorrências, então recorrência NÃO FUNCIONAL como repetição automática e deve ser tratada como PARCIAL até definir produto. Job Vercel diário chama reconciliação financeira/tarefas; scheduler pg_cron/pg_net por minuto chama dispatch com HMAC. O estado remoto desses jobs e entrega push não foi verificado nesta rodada.

**Evidência.** O check real de B criou audiência e confirmou três notificações pendentes persistidas com os intervalos informados. O script falhou antes das etapas posteriores de cancelamento/reativação e dispatch. Tarefa, responsável, conclusão, histórico e push real NÃO VERIFICADOS.

**Permissões/dependências.** tasks:create/view/update, calendar:create/view/update, notifications:view/update. Roles de advogado/secretaria e financeiro têm conjuntos diferentes. Integrações: PostgreSQL scheduler, Vercel/pg_cron, Web Push/VAPID.

### Jornada F — Portal do cliente

**Interface e rotas.** apps/web/features/portal/client-portal.tsx é carregado na área Minha área. Usa GET /auth/me, GET/POST /client-messages, GET /documents e GET /documents/:id/download-url; telas comuns da ficha expõem apenas o que o permission code permite.

**Acesso e regras.** Administrador pode convidar uma conta e associar clientId no vínculo, com papel client; opção delivery=LINK retorna URL para cópia, sem entrega SMTP. AuthenticationGuard exige membership ativa e constrói actor.clientId. Serviço de mensagem impede envio a outro cliente; listagem de documentos filtra por clientId e visibility=CLIENT. Notas internas e administração são negadas ao papel cliente. Migrations definem RLS de leitura/escrita para portal.

**Entidades e permissões.** Profile, User, OrganizationMember, OrganizationMemberRole, Client, Document/Version, ClientMessage, Notification e AuditLog. Papel client tem clients/matters/contracts/receivables/payments/documents/calendar view, messages view/create e notifications view/update; o filtro por vínculo continua obrigatório.

**Evidência e lacuna.** Convite e recuperação por Auth foram testados com profissional fictício em link manual, mas não com um cliente associado. O run parou antes das asserções integradas de portal, RLS, mensagem e notifications. UI E2E anterior é simulada. Nenhum acesso de cliente ao portal é declarado operacionalmente confirmado por esta rodada.

**Dependências.** Confirmar política RLS no alvo, testar membro cliente com vínculo e sem vínculo, acesso entre clientes e organizações, visibilidade por documento, mensagens próprias/externas, notificações próprias e link de download expirado. Definir entrega de convite sem SMTP.

## 5. Plano de construção — não executar

### Segurança

| Proposta                                                        | Arquivos/módulos                                                                                     | Dependência                                                              | Risco                                              | Teste de aceite                                                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Redigir/remover token de assinatura da URL de logs e erro       | apps/api/src/app.module.ts, common/api-exception.filter.ts, documents/document-signing.controller.ts | Escolher transporte de token e formato de log                            | Alto: bearer concede leitura/assinatura temporária | Requisição de assinatura sintética nunca aparece em logs, erro, traces ou requestId; rate limit público testado |
| Limitar upload antes de bufferizar; alinhar teto HTTP e negócio | documents.controller.ts, documents.service.ts, storage.service.ts, configuração compartilhada        | Definir tamanho máximo de produto e estratégia stream/arquivo temporário | Alto: pressão de memória                           | Limite, MIME, arquivo inválido e concorrência testados sem exceder memória configurada                          |
| Manter autorização por tenant e objeto                          | AuthenticationGuard, PermissionGuard, módulos clients/matters/finance/documents/work                 | Projeto Supabase isolado                                                 | Alto: exposição de dados jurídicos                 | Testes API e RLS com dois tenants e clientId distintos em todos os objetos das jornadas                         |
| Triar dependências npm audit                                    | package.json e lockfile                                                                              | Compatibilidade por versão transitive; sem upgrade major automático      | Médio/alto conforme pacote/exposição               | SBOM e advisory por pacote, unit/build/E2E e SCA sem findings aceitos ou exceções justificadas                  |

### Infraestrutura e ambiente

| Proposta                                                                           | Arquivos/módulos                                                    | Dependência                                       | Risco                                                   | Teste de aceite                                                                                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Criar alvo Supabase TEST/DEV local ou projeto dedicado com confirmação verificável | tools/supabase, .env.example, workflow de CI                        | Docker/Supabase CLI e aprovação do projeto        | Alto se env for apontado ao banco errado                | Guard falha para produção/ref divergente e passa somente para project ref de teste                                              |
| Repetir QA de seis jornadas com tenants sintéticos e cleanup conhecido             | tools/qa/verify-workflows.ts, workflow quality                      | Base de teste, API compilada, Storage configurado | Médio: acumular arquivos/registros sintéticos           | relatório PASS com IDs sintetizados; tenants arquivados e Auth identidades banidas; nenhuma leitura/escrita fora dos IDs de run |
| Verificar RLS, migrations, buckets, backups e restore                              | supabase/migrations, tools/supabase/inspect-remote.ts, runbook docs | projeto correto e backup de teste                 | Alto: alterar alvo ou descobrir ausência de restauração | leitura de estado comparada ao schema; restore de DB+Storage em projeto descartável e RPO/RTO documentados                      |
| Completar SMTP/VAPID/jobs                                                          | configuração de ambiente, notifications e deploy docs               | provedor e DNS; dispositivo QA                    | Médio/alto de entrega falsa                             | convite/reset recebido em mailbox sintética; push real; job executa uma vez, retry/replay seguro                                |

### Conclusão dos fluxos e consistência de dados

| Proposta                                                                                 | Arquivos/módulos                                                                        | Dependência                                                   | Risco                                           | Teste de aceite                                                                                                                          |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Corrigir verificador documental: versão atual PDF, versão anterior DOCX, comparar hashes | tools/qa/verify-workflows.ts, documents.service.ts, DocumentVersion                     | Compatibilizar aceite com contrato atual DOCX/PDF             | Médio: falso negativo impede testes posteriores | Geração, versões 1 e 2, bytes assinados, hash persistido e link expirado testados via Storage real                                       |
| Completar jornada A no QA                                                                | clients controller/service, matters controller/service, pipelines, ferramentas QA       | Roles de advogado/secretaria e pipeline seed                  | Médio: referência atribuída ao membro errado    | Criar contato e matter, associar responsável do mesmo tenant, rejeitar usuário externo, mover etapa e conferir histórico                 |
| Definir ciclo de Expense                                                                 | finance.schemas/controller/service, Expense, finance UI, reports.service.ts e dashboard | Decisão de produto sobre aprovação, pagamento e reembolso     | Alto: valor financeiro sem estado confiável     | Criar→submeter→aprovar/rejeitar→pagar/cancelar, concorrência, trilha e reflexo em relatório/fluxo de caixa                               |
| Exercitar a cadeia B completa                                                            | finance, reports, Prisma e QA                                                           | Reparo do check documental para alcançar estágios posteriores | Alto: saldo ou tenant errado                    | Parcelas somam contrato, idempotência, alocação excessiva recusada, aprovação, saldo e relatórios conferidos com Decimal em dois tenants |
| Completar tarefas/calendário                                                             | work.schemas/service, notifications, scheduler, UI                                      | Definir semântica de recorrência e canais                     | Médio/alto por prazo perdido                    | Criar tarefa atribuída, concluir/histórico, lembrete due, audiência cancelada/reschedulada, timezone e duplicação de dispatch            |
| Validar portal por papel cliente e RLS                                                   | admin, auth, portal, documents, work, migrations de portal                              | Conta cliente sintética vinculada e RLS ativa                 | Alto: vazamento de cliente                      | Portal vê somente clientId próprio; mensagens próprias aceitas, externas negadas; notas/admin bloqueados; arquivo depende de visibility  |
| Recuperar operação de assinatura em falha                                                | document-signing.service.ts, Storage, ScheduledJobState/DocumentSigningRequest          | Definir idempotência e compensação de objetos                 | Médio/alto em PROCESSING/storage órfão          | Falhar cada passo entre claim, download, upload e transação; retry não duplica nem deixa estado preso                                    |

### Experiência, decisões de produto e recursos novos

- **Decisão de produto:** um membro pode pertencer a várias organizações? Se sim, fornecer seletor e endpoint seguro de memberships; se não, rejeitar segunda membership. Afeta authentication.guard.ts, api.ts e shell.
- **Decisão de produto:** despesas terão aprovação e pagamento no app, ou serão registro informativo? Não construir estados de enum sem fluxo ou confirmação.
- **Decisão de produto:** recurrenceRule deve criar ocorrências em série? Definir edição/cancelamento, fuso e feriados antes de implementar.
- **Decisão de produto/jurídica:** texto permitido para assinatura e identidade do signatário; exigir revisão legal antes de vender como assinatura com garantia maior.
- **Melhoria UX:** explicitar que convite/WhatsApp apenas abre/copia link enquanto envio não tiver comprovante; mostrar erro/estado de tarefa e prazos com ação clara.
- **Novo, depende de validação comercial:** provisioning self-service de escritório, planos e cobrança SaaS, gateway de pagamento e integração com tribunal/WhatsApp API. Não são bloqueios técnicos que devam ser implementados sem decisão de produto.

## 6. Critério de prontidão para escritório

Antes de declarar prontidão operacional, exigir: seis jornadas executadas em alvo TEST/DEV confirmado; nenhuma etapa crítica baseada apenas em mock; isolamento por organização/cliente validado em API e RLS; dinheiro conciliado com valores Decimal e relatórios; transições de estados completas; Storage e assinatura com prova de integridade; alertas recebidos em ambiente real de QA; backup/restauração demonstrados; e revisão de segurança de upload, tokens e dependências.

### Resumo compartilhável com ChatGPT

Estamos validando o Lívio Jurídico, sistema Next.js/React + NestJS + Prisma/PostgreSQL Supabase. No checkout local a branch é main, HEAD 919a5accc91bc96dbd87773411668d017f968e35, com 81 arquivos rastreados alterados e 48 entradas não rastreadas (47 eram anteriores; a entrada extra é a documentação de auditoria). Não descartar nem substituir essas alterações.

O .env está marcado como development, mas aponta para Supabase e PostgreSQL remotos; SUPABASE_LOCAL=false e a confirmação do project ref coincide. A API foi compilada localmente e o QA script conectou essa API ao projeto remoto de desenvolvimento. Não há Docker/Supabase CLI, portanto não existe stack local isolada. O projeto production não foi carregado nem acessado. O teste criou dados exclusivamente sintéticos em dois tenants QA, que o script suspende/arquiva e cujas identidades bane; histórico e arquivos de evidência permanecem.

Evidência integrada nesta rodada: autenticação/membership, convite e recuperação por link, cadastro PF/PJ, rejeição de duplicata/CPF inválido, barreiras de tenant, upload/leitura assinada/remoção de foto, catálogo de serviços, recebível de R$ 1.000 dividido em três parcelas exatas, contrato vinculado e audiência com lembretes. O script parou quando esperava DOCX no download da versão atual; a API devolveu PDF (comportamento do código: cria DOCX e depois PDF). A URL assinada respondeu HTTP 200. Isso é divergência do QA harness, não falha confirmada do produto; o hash não chegou a ser conferido.

Classificação das seis jornadas: A PARCIAL (cliente e auth reais; contato/processo/atribuição/status não testados); B PARCIAL (parcelamento/contrato reais; pagamento, saldo e relatórios não alcançados neste run); C PARCIAL (só criar/listar despesa existe, não há aprovação/pagamento e cash forecast usa parcelas de recebíveis); D PARCIAL (geração/download iniciados, upload/versionamento/assinatura/hash não concluídos); E PARCIAL (audiência e lembretes criados, tarefa/conclusão/dispatch/recorrência não testados; recurrenceRule não expande ocorrências); F PARCIAL (portal e RLS no código, não alcançados na integração atual).

Próximas prioridades: corrigir o teste de versões DOCX/PDF; validar A/B/D/E/F em QA até o fim; desenhar o ciclo de despesas; corrigir exposição potencial do token de assinatura em URL/log/error; alinhar o limite de upload do interceptor ao de negócio; confirmar RLS/backup/restore e triagem dos nove findings npm audit reportados anteriormente. Nenhuma correção foi implementada. Detalhes e arquivos de aceite estão neste documento e em 03-INVENTARIO_FUNCIONAL.md, 07-SEGURANCA_E_PERMISSOES.md e 11-PLANO_DE_EVOLUCAO.md.
