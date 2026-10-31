# Contexto para outra IA

## Resumo executivo

Você está trabalhando no repositório Controle Financeiro Lívio, um monorepo TypeScript estrito para operação de escritório jurídico. A arquitetura local inclui web Next.js 16/React 19, API modular NestJS 11, Prisma 6/PostgreSQL Supabase, Supabase Auth/Storage, pacotes compartilhados de tipos/permissões/UI, 16 migrações SQL, ferramentas e documentação.

O produto une clientes/contatos, pipelines e processos, contratos, recebíveis e pagamentos, documentos e assinatura por link, tarefas/prazos, calendário, mensagens/notas, notificações, relatórios, portal e auditoria. A shell web oferece 16 áreas dentro de uma rota principal. API tem 14 controllers e 110 handlers, com prefixo /v1. Prisma tem 45 models e 25 enums.

Esta auditoria não acessou banco remoto, não aplicou migration, não fez deploy e não criou dados. O checkout já continha 81 modificações rastreadas e 47 arquivos não rastreados antes dos documentos; ele não deve ser tratado como HEAD ou versão implantada sem comparação.

## O que foi verificado

- Format check, lint, typecheck, 155 testes unitários, validação Prisma, build, verificação de bundle e 21 cenários Playwright passaram localmente.
- O E2E interceptou/mocou as chamadas API. Portanto, nenhum dos 110 handlers foi exercitado em API/DB real nesta auditoria.
- npm audit --omit=dev reportou nove findings (sete high e dois moderate); nenhuma atualização foi feita.
- Schema Prisma listou 45 models; migrações SQL locais somam 16.
- API aplica guards globais de auth, rate-limit e permission e intercepta contexto tenant; queries de serviço incluem organização.
- Os arquivos de deploy/configuração e PROJECT_CONTEXT têm histórico de ativação em homologação, mas o ambiente remoto não foi reconsultado.

## Estado funcional

- CONFIRMADO localmente por checks: compilação e comportamento definido pelos testes executados.
- IDENTIFICADO NO CÓDIGO: módulos e operações catalogados; isso não prova integração externa.
- PARCIAL: administração multi-organização pela UI; ciclo de despesas; edição/remoção de contatos, contratos e papéis; recorrência de calendário; assinatura e entrega push/email reais.
- NÃO FUNCIONAL: exportação PDF por CsvExportService é um stub que rejeita explicitamente; UI observada usa CSV.
- LEGADO provável: Dashboard estático em apps/web/features/dashboard/page.tsx não integrado à shell.
- NÃO VERIFICADO: DB/RLS/buckets atuais, deploy, SMTP, VAPID/push real, backup/restore, Storage, migrations aplicadas e jornadas autenticadas de ponta a ponta.
- POTENCIAL: cobrança SaaS, provisioning self-service, gateway e integrações externas; não estão implementados.

## Riscos prioritários

1. Token bearer de assinatura está em URL; Pino pode registrar URL e filtro de erro devolve originalUrl. Não reproduzir tokens em logs/documentação.
2. Upload de documento é bufferizado até 100 MiB pelo interceptor antes do limite de serviço (default 20 MiB).
3. Nove vulnerabilidades transitivas de dependências de produção precisam ser triadas; não aplicar upgrade major sem compatibilidade.
4. Não há confirmação nesta auditoria de backups/restauração, scanner antimalware ou DB/RLS atuais.
5. Usuários multi-membership não encontram seletor de organização na UI; API exige header em contas com mais de uma.
6. Assinatura online produz trilha PDF e hash, mas não garante identidade forte/certificado qualificado. Não a descreva como ICP-Brasil.

## Decisões técnicas a preservar

- Mantenha limites apps versus packages e TypeScript estrito.
- Toda operação de negócio precisa de organization autenticada e permissionamento explícito no backend; não confiar em ocultar botões.
- Use organization_id e RLS nas entidades operacionais.
- Dinheiro permanece Decimal/string; pagamentos corrigidos por evento compensatório e transação, não float ou edição destrutiva.
- Use schemas compartilhados/validação Zod, errors/requestId seguros, logs sem credenciais e arquivos em buckets privados.
- Não aplique migrações sem confirmar projeto Supabase de desenvolvimento; nunca reset/DROP/TRUNCATE.
- Dados e configuração fora de componentes de renderização; componentes acessíveis/responsivos; motion conforme apps/web/theme e PROJECT_CONTEXT.
- Não revelar valores .env nem copiar tokens de links.

## Glossário

| Termo                                 | Significado no domínio                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| Organization                          | Escritório/tenant que delimita acesso a registros.                                  |
| Membership / OrganizationMember       | Vínculo de identidade de usuário com organização, papel e clientId opcional.        |
| Role / Permission                     | Papel agrega permission codes usados pela API para autorizar operações.             |
| Client                                | Pessoa física ou jurídica atendida; pode ter contatos.                              |
| Matter                                | Processo/caso jurídico, associado ao cliente, pipeline/estágio, partes e histórico. |
| Pipeline / Stage                      | Funil e etapa de trabalho/comercial.                                                |
| Contract                              | Condição de serviço/honorários ligada a cliente/processo.                           |
| Receivable / Installment              | Valor a receber e parcelas programadas.                                             |
| Payment / Allocation                  | Pagamento registrado e valor distribuído a uma ou mais parcelas.                    |
| Reversal / Adjustment / Renegotiation | Eventos financeiros compensatórios ou mudança controlada do plano.                  |
| Document / Version                    | Registro lógico do documento e revisão imutável do arquivo privado.                 |
| Signature request                     | Solicitação por bearer link ligada a uma versão/hash e evidência de aceite.         |
| InternalNote / ClientMessage          | Conteúdo privado do escritório versus conteúdo intencionalmente exposto ao cliente. |
| ActivityEvent / AuditLog              | Telemetria/visualização versus mudança administrativa/de negócio.                   |

## Índice cruzado

| IDs               | Localizar em                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| F01–F30, L01      | 03-INVENTARIO_FUNCIONAL.md; interfaces relacionadas em 04-TELAS_E_FLUXOS.md                        |
| T01–T16           | 04-TELAS_E_FLUXOS.md                                                                               |
| API               | 06-APIS_E_INTEGRACOES.md; handlers em apps/api/src/<domínio>/*.controller.ts                       |
| Dados             | 05-BANCO_DE_DADOS.md; definição canônica em packages/db/prisma/schema.prisma e supabase/migrations |
| Segurança S01–S09 | 07-SEGURANCA_E_PERMISSOES.md                                                                       |
| Problemas P01–P18 | 09-PROBLEMAS_E_PENDENCIAS.md                                                                       |
| Prioridades       | 11-PLANO_DE_EVOLUCAO.md                                                                            |

## Próximos passos possíveis

Comece comparando o checkout com branch/deploy de referência e lendo PROJECT_CONTEXT.md. Para qualquer operação persistente, confirme primeiro qual projeto de desenvolvimento está autorizado e use ambiente isolado. Prioridade sugerida: URL/token de assinatura, limite/streaming de upload, triagem das vulnerabilidades, estado de RLS/backup, fluxo de múltiplas memberships e conclusão dos ciclos de despesa/recorrência.

## Documentos para aprofundar

01 Visão geral; 02 Arquitetura técnica; 03 Inventário funcional; 04 Telas e fluxos; 05 Banco de dados; 06 APIs e integrações; 07 Segurança e permissões; 08 Testes e evidências; 09 Problemas e pendências; 10 Análise de produto; 11 Plano de evolução; 13 Resumo para ChatGPT.
