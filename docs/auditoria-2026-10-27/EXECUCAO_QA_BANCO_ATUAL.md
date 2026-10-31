# Execução QA integrada no banco atual

**Data:** 2026-10-27  
**Checkout:** `main`, HEAD `919a5accc91bc96dbd87773411668d017f968e35`  
**Resultado geral:** seis jornadas avaliadas; 3 PASS, 2 PARTIAL e 1 FAIL. O Lívio **não está comprovado como integralmente operacional**.  
**Escopo:** testes API/Auth/PostgreSQL/Storage com fixtures sintéticos; nenhuma funcionalidade de negócio foi implementada ou alterada.

**Validação local:** `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` (155/155), `npm run db:validate`, `npm run build` e TypeScript direcionado dos scripts QA passaram. Os testes unitários locais não substituem os resultados integrados abaixo.

## Destino e salvaguardas

- Auth, PostgreSQL e Storage foram confirmados no projeto Supabase `ioebcdpyrszokdyaoaqv`; os hosts e identidade do banco coincidiram. Os buckets privados esperados estavam presentes e RLS estava habilitada e forçada em 13/13 tabelas da matriz QA.
- A ref coincide com a associada a Vercel Production e Preview na documentação do repositório. O nome no painel de controle não foi verificado nesta execução. Portanto, este **não é um ambiente TEST/DEV separado**. O proprietário autorizou a utilização sintética da infraestrutura atual; a autorização não cobre registros preexistentes.
- O inventário somente leitura encontrou uma organização ativa sem marcador QA, com um cliente, contato e membro; também encontrou uma identidade Auth em domínio potencialmente entregável. Os dados foram tratados como potencialmente reais e não foram lidos em detalhe nem alterados. O inventário antes/depois manteve os mesmos totais não classificados: 1 organização, 1 cliente, 1 contato, 1 membership e 2 logs de auditoria.
- O `pg_cron` `livio-notifications` estava ativo a cada minuto, apontava para a API conhecida de produção e as dez execuções recentes tinham terminado com sucesso. Não foi desativado, pois isso alteraria infraestrutura compartilhada. A rotina reconciliava notificações internas; não havia assinatura push cadastrada, nem credenciais locais de SMTP, cobrança ou outros canais externos. O fluxo de convite usou geração/consumo de link, sem envio de e-mail. Nenhuma cobrança externa foi chamada.
- Como esse job permaneceu ativo e consulta membros ativos de todas as organizações, não é possível atribuir por organização eventuais reconciliações internas ocorridas nos tenants QA preexistentes durante a janela: a comparação anterior era agregada. Não há evidência de alteração nos registros não classificados, cujas contagens permaneceram iguais. Esse limite fica registrado; o job não foi alterado.
- O inventário após os testes mostrou que as novas linhas/objetos pertenciam aos prefixos QA; não apareceu registro adicional na organização não classificada. A quantidade de notificações não classificadas permaneceu zero. O agendador não foi modificado.
- Os testes usaram a API local e JWTs Auth reais de usuários sintéticos (administrador, advogado, secretaria, financeiro e cliente), não service-role para representar esses papéis. Service-role ficou restrita ao setup/encerramento administrativo e leitura de metadados. Contas e organizações usaram padrões sintéticos `qa-*` e `@example.test`, sem CPF/CNPJ atribuídos a pessoas reais.
- Nenhuma migration, alteração de schema, deploy, upgrade ou mudança de regra de negócio foi feita. A API foi iniciada localmente; não houve teste do frontend conectado ao backend real.

## Resultados por jornada

### A. Clientes e processos — PASS

**Esperado:** cliente PF/PJ e contato; processo com responsável; alteração de status e etapa; histórico; permissões e fronteira entre organizações.

- Criados cliente PF e PJ sintéticos sem identificadores pessoais, contato e processo. Foram atribuídos advogado e secretaria; status mudou de `LEAD` para `ACTIVE`, etapa mudou e o histórico/timeline persistiu duas entradas.
- Secretaria leu clientes e recebeu 403 ao consultar despesas. Perfil financeiro recebeu 403 ao criar/alterar processo. Usuário de outra organização recebeu 404 para cliente/processo; selecionar a organização errada no token foi rejeitado.
- Cadastro, leitura, atribuição, mudança de status/etapa e histórico foram confirmados por API e PostgreSQL. Teste de foto privada também passou: upload, URL assinada, download, rejeição de arquivo inválido/acesso entre tenants e remoção.
- **Não verificado:** uso dessas operações pela interface web conectada à API real.

### B. Contratos e financeiro — FAIL

**Esperado:** contrato/recebível parcelado, pagamento total/parcial, idempotência concorrente, saldo, correções, relatórios e isolamento.

- Catálogo, contrato, audiência vinculada e recebível de `R$ 1.000,00` em parcelas decimais `333,33`, `333,33` e `333,34` foram criados e persistidos.
- Passaram: rejeição de pagamento acima do saldo; duas requisições concorrentes com a mesma chave idempotente retornando o mesmo pagamento; repetição da chave sem duplicação; valor parcial exato; solicitação de correção pelo perfil financeiro; 403 para aprovação sem papel; aprovação única pelo administrador e 409 na repetição; relatório agregado `R$ 880,00`; leitura por outra organização negada.
- Falhou a etapa essencial de saldo: `GET /v1/clients/:id/overview` retornou HTTP 500 depois do pagamento parcial e novamente depois da correção aprovada. O log local registra Prisma `P2024`, limite de uma conexão e timeout de 10 s; o overview dispara aproximadamente onze consultas em `Promise.all`. As operações de pagamento e relatório passaram, mas a jornada financeira completa não.
- **Não verificado:** duas chaves de idempotência distintas concorrendo pelo mesmo saldo restante. A concorrência testada usou a mesma chave e o mesmo pagamento.
- **Correção necessária:** reduzir/serializar as consultas concorrentes do overview ou configurar e validar um pool compatível com o destino; depois testar o overview com pool limitado e carga concorrente. Não foi feita alteração de negócio nesta execução.

### C. Despesas — PARTIAL

**Esperado:** criação/listagem isoladas e identificação das transições existentes.

- `POST /v1/finance/expenses` criou despesa sintética de `R$ 74,19`; `GET /v1/finance/expenses` a listou e o PostgreSQL preservou o Decimal exatamente.
- A inspeção do controller confirma somente esses endpoints para despesas. Não há operação de atualização, aprovação, pagamento, cancelamento ou previsão financeira.
- **Não implementado:** ciclo de aprovação/pagamento e previsões. Nenhum fluxo foi simulado por atualização direta de banco.
- **Dependência:** decisão de produto sobre estados, papéis, auditoria e efeito financeiro antes de desenvolver transições.

### D. Documentos e assinatura — PARTIAL

**Esperado:** geração, upload/versionamento, hash, download, visibilidade, assinatura, revogação e recuperação.

- `POST /v1/documents/generate` recusou a geração de contrato com HTTP 400 porque exige CPF válido. Para evitar um CPF potencialmente real, essa geração foi registrada como bloqueio e o teste prosseguiu pela rota de upload.
- O fluxo sintético carregou DOCX e depois PDF; confirmou formato/MIME, versão anterior e atual, metadados da API contra PostgreSQL, tamanho e SHA-256 persistido contra cada arquivo baixado. As URLs apontaram ao Storage do mesmo projeto, retornaram download HTTP 200 e declararam TTL de 300 s; os claims `iat`/`exp` também mostraram 300 s. A checagem corrigida passou.
- A assinatura sintética confirmou hash da imagem e do documento, validação de signatário inválido sem consumir o pedido, assinatura posterior bem-sucedida e rejeição do token já consumido. Um segundo pedido foi revogado e o link revogado retornou 410. O PDF assinado ficou como documento interno separado.
- **Não verificado:** aguardar 300 s para comprovar a expiração no tempo; geração DOCX/PDF por template com um fixture seguro e sem identificador pessoal; requisitos jurídicos de assinatura qualificada/avançada.
- **Correção/decisão necessária:** definir dados de teste seguros e a regra funcional para geração quando o cadastro não contém identificador fiscal. Não usar CPF de cliente ou um número atribuído a pessoa real.

### E. Tarefas e agenda — PASS

**Esperado:** tarefa, responsável, atualização, conclusão, histórico, lembrete e audiência cancelada/reagendada.

- Tarefa sintética foi criada, atribuída ao advogado, atualizada, comentada e concluída. A API e `task_history` confirmaram quatro ações; o lembrete vencido foi reconciliado uma vez e gerou notificação `IN_APP` interna.
- Audiência foi reagendada com novos horários de lembrete, cancelada e reativada; contagem de alertas refletiu as transições. A reconciliação manual repetida não duplicou o alerta.
- Estado observado: `pg_cron` ativo e dez execuções recentes bem-sucedidas. Isso confirma execução do job, não entrega a um dispositivo. Não havia push subscriptions; entrega push/e-mail não foi testada. O cron Vercel aparece configurado no repositório, mas sua execução/saúde não foi confirmada.
- **Não implementado:** expansão de recorrência em ocorrências; não foi alterada.

### F. Portal do cliente — PASS

**Esperado:** identidade cliente com `clientId`, registros próprios, bloqueio de outros clientes/organizações, documento visível, mensagens/notificações próprias e negação administrativa.

- JWT real de cliente sintético, vinculado explicitamente ao cliente PF. Leitura direta com JWT e chave anônima sob RLS retornou apenas o cliente e contatos vinculados; recebeu os próprios documentos visíveis, mensagens, notificações, recebíveis e pagamentos.
- Acesso a overview de outro cliente e documento visível de outro cliente foi negado; documento interno não ficou visível. Usuário de outra organização não encontrou o cliente sintético. Inserção de mensagem para outro cliente foi rejeitada; mensagem própria foi aceita. Atualização de notificação administrativa não alterou a linha.
- `/internal-notes`, `/audit-logs`, `/admin/users`, `/finance/expenses` e relatório financeiro foram negados ao perfil cliente. RLS estava forçada nas 13 tabelas da matriz e foi exercitada diretamente em clientes, contatos, documentos, recebíveis, pagamentos, mensagens e notificações.
- **Decisão de produto:** a RLS atualmente permite ao cliente ler seus próprios recebíveis e pagamentos. Confirmar se essa exposição financeira faz parte do portal desejado; o escopo entre clientes e organizações foi validado.

## Artefatos

O run final, executado após a correção do verificador de TTL, é a evidência principal:

- `test-results/qa-workflows-1793141782072-70c057.json` — status e etapas das seis jornadas.
- `test-results/qa-workflows-1793141782072-70c057-summary.json` — cópia normalizada que separa a evidência de documentos da evidência financeira; o JSON original permanece intacto.
- `test-results/qa-api-1793141782072-70c057.log` — API local; inclui a falha Prisma `P2024` com tokens redigidos.
- `test-results/qa-current-target-readonly-1793138242459.json` — inventário de contagens antes das escritas.
- `test-results/qa-current-target-readonly-1793143231811.json` — inventário somente leitura depois dos testes.
- `test-results/qa-cleanup-1793143134904.json` — verificação de retenção e contagens exatas dos run IDs desta execução.
- Execuções iterativas anteriores: `qa-workflows-1793138640111-10b404.json`, `qa-workflows-1793139303947-ff2348.json`, `qa-workflows-1793140092989-ca5a80.json` e `qa-workflows-1793140814330-a4f327.json`, cada uma com log API homônimo. O run de inicialização `1793138578628-f17171` falhou antes de criar organização ou usuário de negócio.

O resultado do último run é `FAIL` geral por causa do financeiro; documentos e despesas são `PARTIAL`. O QA registra cada fluxo e continua os outros módulos após falha documental. A coleta de evidências financeiras não mistura mais checks documentais em execuções futuras; o ajuste do range foi feito após o run final e não altera os resultados funcionais registrados.

## Encerramento e dados sintéticos retidos

- Cinco runs de escrita produziram 10 organizações, 35 identidades Auth e registros apenas nos respectivos tenants. Ao terminar, todas as 10 organizações estavam arquivadas, as 35 memberships suspensas e as 35 identidades banidas. O inventário pós-teste confirmou esses estados e a estabilidade das contagens não classificadas.
- Tentamos remoção física em transação estritamente limitada aos cinco `runId`s; o PostgreSQL rejeitou a transação com `Immutable history cannot be changed`, e a transação inteira foi revertida. Nenhum objeto Storage ou usuário Auth foi removido por essa tentativa. O teste não desabilitou triggers nem alterou retenção.
- Permanecem como evidência sintética arquivada: 176 logs de auditoria, 10 históricos de etapa, 20 históricos de tarefa, 4 reversões, 21 versões imutáveis de documento, 4 eventos imutáveis de acesso e 5 pagamentos confirmados; esses registros mantêm relações com documentos/arquivos e entidades pai. Também permanecem 21 objetos em `legal-documents` e 3 em `document-signatures`. Fotos de cliente foram removidas pelo próprio cenário. Não apagar manualmente sem política aprovada para retenção e trilha de auditoria.
- O script `tools/qa/cleanup-workflows.ts` foi restringido a auditoria somente leitura. O uso `--apply` é recusado. Para remover os tenants restantes, é necessária decisão do responsável sobre retenção/anonymização de evidências e um procedimento compatível com as triggers imutáveis. Não houve alteração de qualquer entidade não pertencente aos run IDs QA.

## Segurança e riscos conhecidos

- Token de assinatura em URL pode aparecer em logs/referer; o QA confirmou armazenamento por hash e consumo único, mas não avaliou exposição em logs de produção. Achado anterior permanece sem correção.
- A amostra dos cinco logs API desta execução não contém bearer não redigido nem rota pública com token de assinatura. Isso não demonstra o comportamento dos logs/telemetria publicados.
- Upload permanece bufferizado antes da validação completa de tamanho (interceptor até 100 MiB frente ao limite funcional padrão de 20 MiB); não foi feito teste de estresse.
- A auditoria anterior registrou nove vulnerabilidades em dependências de produção (7 altas e 2 moderadas). Não houve `npm audit` novo nem upgrade nesta execução.
- O job compartilhado segue apontado à API conhecida de produção. Mesmo sem canais externos ativos para esta execução, uso repetido do mesmo projeto acumula histórico QA e deve ficar condicionado a autorização e escopo sintético.

## Plano de evolução por prioridade

| Prioridade | Classe    | Módulo                         | Próxima ação e dependências                                                                                                                                            | Teste de aceite objetivo                                                                                                                                                                                      |
| ---------- | --------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0         | CORRIGIR  | Clientes/financeiro — overview | Reduzir paralelismo/conexões concorrentes ou ajustar pool com capacidade validada; não mascarar `P2024`.                                                               | Sob pool limitado a 1, overview retorna 200 em carga concorrente; saldos parciais conciliam; teste adicional com duas chaves distintas deixa somente pagamentos cobertos pelo saldo confirmados; sem `P2024`. |
| P0         | DECIDIR   | QA/retention                   | Definir com responsável como preservar/apagar trilhas imutáveis e seus objetos Storage em execuções futuras. O banco atual também está associado a Production/Preview. | Procedimento aprovado identifica tenants por `runId`, bloqueia dados fora deles, reconcilia triggers/FKs/Storage e conserva artefato local verificável.                                                       |
| P1         | COMPLETAR | Documentos                     | Definir fixture legalmente segura ou comportamento de geração sem identificador fiscal; depois validar geração de template.                                            | Geração retorna DOCX anterior/PDF atual com metadados, hashes e bytes conciliados; URL válida anuncia TTL de 300 s; link consumido/revogado retorna 410.                                                      |
| P1         | CORRIGIR  | Segurança documental           | Revisar vazamento de token em URL/logs e limites de upload em memória; triagem individual das dependências reportadas.                                                 | Testes de log/resposta sem token; uploads abaixo/no/acima do limite sem buffer excessivo; cada advisory resolvido ou justificado e suíte local passa.                                                         |
| P1         | DECIDIR   | Portal financeiro              | Confirmar se cliente lê recebíveis/pagamentos próprios e quais campos/status são expostos.                                                                             | Matriz assinada de papéis/clientId; JWT do cliente lê apenas campos autorizados do próprio client; nenhum acesso cruzado.                                                                                     |
| P2         | DECIDIR   | Despesas                       | Definir estados, aprovação, autorização por papel, reversão e se haverá previsão financeira.                                                                           | Critérios de aceite aprovados antes de qualquer endpoint de transição; Decimal exato e trilha auditável nos cenários.                                                                                         |
| P2         | COMPLETAR | Agenda/notificações            | Definir recorrência/timezone e ambiente controlado para entrega de e-mail/push; confirmar observabilidade do cron Vercel.                                              | Audiências recorrentes materializam instâncias conforme regra aprovada; job real conclui sem duplicação; canal de teste recebe somente destinatário sintético.                                                |
| P2         | VALIDAR   | Interface web                  | Fazer Playwright contra API e Auth de ambiente explicitamente autorizado, sem mocks.                                                                                   | Fluxos de cliente, financeiro, documentos, agenda e portal funcionam em 360 px e desktop com tokens por papel e isolamento mantido.                                                                           |

**CRIAR:** nenhum novo módulo de produto foi justificado pelos resultados desta rodada. As lacunas de despesas e recorrência requerem decisão funcional antes de implementação.

## Arquivos alterados nesta missão

- QA: `tools/qa/verify-workflows.ts` (TTL por claims e evidência financeira separada), `tools/qa/cleanup-workflows.ts` (auditoria de retenção somente leitura), `tools/qa/inspect-current-target.ts` (inspeção read-only com lint corrigido) e `tools/qa/README.md`.
- Documentação: este relatório, `docs/auditoria-2026-10-27/VALIDACAO_INTEGRADA_FINAL.md`, `docs/infra/AMBIENTE_TEST_DEV.md` e `PROJECT_CONTEXT.md`.
- Evidências locais geradas: inventários read-only antes/depois, JSON e logs API dos runs, e plano de retenção em `test-results/`. Nenhum segredo foi gravado nos documentos.
- Não houve alteração de aplicação de negócio, Prisma/schema, migrations, configuração de produção ou dependências.
