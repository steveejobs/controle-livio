# Cobertura funcional de QA

O E2E de clientes verifica o avanço automático entre cadastro, financeiro, honorários e documentos,
incluindo a vinculação da cobrança ao contrato e a geração sequencial dos três modelos em 360 e 1440 px.

Atualizado em 2026-10-21. Os testes de navegador usam respostas isoladas da API; a verificação remota
consulta uma organização sintética existente e não altera dados de negócio.

| Área                             | Navegador automatizado                                                                                                                                                                                                        | API remota de desenvolvimento                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Login, nova senha e recuperação  | Visibilidade da senha, teclado, validação e envio simulado da recuperação                                                                                                                                                     | Auth usado para obter sessão QA; entrega de e-mail não exercitada |
| Navegação administrativa         | Todas as 15 abas em 360 e 1440 px; CRM unificado exibe pipelines comercial e jurídico; axe e overflow                                                                                                                         | Coleções e permissões de leitura                                  |
| Clientes, processos e documentos | Máscara CPF/CNPJ, qualificação PF/PJ, vínculo cobrança→contrato, geração automática de DOCX para contrato/procuração/hipossuficiência, versões internas, anexos, contato, observação pública, nota interna, paginação e busca | Listagens autenticadas                                            |
| Tarefas, agenda e notificações   | Prazo, prioridade, status, comentário, lembrete, evento, leitura e reconciliação                                                                                                                                              | Listagens autenticadas                                            |
| Financeiro                       | Seleção de parcela do cliente e pagamento com valor decimal exato                                                                                                                                                             | Contratos, recebíveis, pagamentos e despesas em leitura           |
| Administração                    | Convite simulado, reconciliação explícita, pipeline e etapas                                                                                                                                                                  | Usuários, papéis e pipelines em leitura                           |
| Relatórios                       | Seleção dos 12 relatórios e exportação CSV simulada                                                                                                                                                                           | Os 12 relatórios e CSV autenticado                                |
| Portal do cliente                | Mensagem, documento privado, navegação restrita, axe e overflow em 360 e 1440 px                                                                                                                                              | Leitura como cliente e respostas 403 para recursos vedados        |

Os E2E do cadastro também conferem rótulos de cobrança específicos, avanço entre etapas e campos
condicionais de honorários fixos, por êxito e mistos. A administração verifica exemplos de primeira
etapa que mudam conforme o tipo de pipeline, e o CRM mostra campos judiciais apenas para processos.
Testes unitários cobrem normalização de valores, conversão percentual decimal, máscara/validação de
documentos, conteúdo monetário decimal, geração de DOCX, validação dos dados PF/PJ, autorização e
configuração administrativa do escritório.

Os fluxos E2E confirmam que o serviço “Acompanhamento em delegacia” não cria audiência sozinho e que
os dois cadastros de contrato permitem adicionar data, local e intervalos personalizados. Testes de
API verificam a criação transacional do evento e dos avisos, entrega idempotente por cron, push do
responsável, reagendamento após mudança de horário e remoção dos avisos quando a audiência é cancelada.

O CRM de cobrança também verifica o cadastro de um objetivo sem valor e a abertura obrigatória de sua
descrição. O fluxo de contratos marca serviços criminais, salva um serviço novo no catálogo da
organização e confirma que ambos são enviados ao contrato; testes da API verificam a consulta por
organização, a auditoria e a proteção contra duplicatas.

Execute `npm run build` e depois `npm run test:e2e` para a suíte de navegador. No Windows com Chrome
instalado, defina `PLAYWRIGHT_CHROME_PATH` para o executável local caso o Chromium do Playwright não
esteja instalado. A verificação remota está documentada em `tools/qa/README.md` e exige a organização
QA identificada explicitamente.

As verificações não demonstram que todas as combinações de dados e permissões estão corretas. Ainda
faltam entrega real de convite/recuperação por SMTP, execução local da suíte RLS/Storage sem Docker,
ensaio isolado de backup/restauração e medições de carga com volume representativo. A web e a API
remotas consultadas são a versão publicada; mudanças locais precisam ser publicadas para validação
remota da nova versão.

## PWA install and system notifications - 2026-10-21

- Browser E2E covers retaining and opening the install prompt, serving `/sw.js`, and enabling/disabling a per-device push subscription. The browser permission, service worker, and push API are simulated in these cases.
- API unit tests cover VAPID environment validation, endpoint allowlisting, organization/user scoping, sending, expired endpoint removal, and containment of provider/database failures.
- The final local run passed 88 unit tests and all 19 E2E scenarios. Format check, lint, TypeScript, Prisma validation, and full build passed.
- This does not prove delivery from a real push provider or display by a real OS. VAPID keys must be configured in the API, the subscription migration must be applied, and a push-capable device/browser must opt in for that check.
- API regression tests also cover payment-change request pending state, administrator approval/rejection, denial for non-administrators, audit, and requester/admin notification.
- Web unit tests execute the service worker in a local VM and verify that a push calls `showNotification`, notification clicks focus the Lívio window, and external-origin navigation is rejected.

## Modelos e atividades administrativas

Modelos de documentos têm testes de inserção de variável, prévia, salvamento, restauração, validação
de dados obrigatórios e rejeição de marcador desconhecido/incompleto. A navegação E2E confere o painel
de atividades, nomes de atores, descrição das ações, campos alterados e novo registro ao reabrir uma
área. Também verifica o aviso de alterações não salvas antes de trocar de modelo. Testes API conferem
tenant, permissões, acesso oficial de Administrador e omissão de valores anteriores/posteriores.

# Homologação real de 2026-10-21/22

`tools/qa/verify-workflows.ts` usa o Supabase confirmado de desenvolvimento/homologação e uma API compilada. O relatório `test-results/qa-workflows-1792631031175-aab762.json` registrou sucesso para Auth e convite por link, cadastro PF/PJ, catálogo, parcelas, contrato/audiência, DOCX/Storage com hash, pagamento/correção aprovada, isolamento API/RLS e alertas de audiência. Os usuários fictícios são banidos e as organizações de QA arquivadas ao final.

Esse ensaio encontrou e levou à correção do FK de sessão legado na auditoria e da política RLS de leitura do portal. A política adicional de escrita do portal foi aplicada depois desse relatório; sua prova direta será repetida. Não há prova de entrega SMTP ou push pelo sistema operacional, nem de restauração de backup.

O relatório final `test-results/qa-workflows-1792634317845-e02f74.json` foi produzido contra a API Vercel publicada e passou em todas as etapas, incluindo a política de escrita do portal, link de convite e link de recuperação de senha aceitos pelo Supabase Auth, mais o callback real da web com redirecionamento e cookie. O agendador ativo teve execução registrada como `succeeded`. Continuam fora dessa prova a entrega de e-mail, push no sistema operacional e restauração.
