# Resumo para ChatGPT — transferência de contexto

## Projeto e objetivo

O projeto Controle Financeiro Lívio / LíVio Jurídico é um monorepo TypeScript estrito que pretende centralizar a rotina jurídica e financeira de escritórios: clientes, processos, contratos, recebíveis, pagamentos, documentos, tarefas/prazos, mensagens, portal e relatórios. Os perfis codificados são administrador, advogado, secretaria, financeiro e cliente. Pequenos/médios escritórios são público hipotético, não validado por pesquisa.

## Arquitetura

- apps/web: Next.js 16, React 19; rotas /, /reset-password, /auth/confirm (handler), /assinar/[token], recursos estáticos PWA. A home contém 16 áreas em tabs/estado local, sem URL individual.
- apps/api: NestJS 11/Express, 12 módulos de domínio e Prisma infrastructure; prefixo /v1; 14 controllers e 110 métodos de rota. Guards globais autenticação, rate limit, permissão; contexto tenant; Zod; Helmet; CORS allowlist; Pino; OpenAPI em /v1/docs.
- packages/db: Prisma 6, 45 models/25 enums; packages/shared: permission codes, schemas/config; packages/ui: UI compartilhada.
- Supabase Auth/PostgreSQL/Storage e 16 migrations SQL. Migrações Prisma antigas estão arquivadas. Vercel hospeda/configura a execução; scheduler pode usar pg_cron/pg_net/Vault.
- Dinheiro Decimal(19,4)/string; isolamento por organization_id; arquivos em buckets privados; migrations não devem ser executadas sem confirmar projeto DEV.

## Capacidades

Inventário detalhado com IDs F01–F30 em docs/auditoria-2026-10-27/03-INVENTARIO_FUNCIONAL.md. Abrange: auth/RBAC, gestão de equipe, clientes/contatos/OCR/foto/WhatsApp, pipelines/processos/timeline, contratos/catálogo, recebíveis/parcelas/pagamentos/reversões/ajustes, despesas, documentos/versionamento/modelos/assinatura, tarefas/calendário/notas/mensagens, notificações/push, relatórios CSV, dashboard, portal, auditoria, busca, PWA e ferramentas. L01 identifica dashboard estático legado.

## Evidência de testes

Checks locais executados e aprovados: format check, lint, TypeScript, 155 unit tests em 43 arquivos, Prisma validate, build, bundle check (252.961 gzip bytes em 9 scripts, abaixo do limite de 260.000) e Playwright (21/21). Os E2E usam browser local e APIs mockadas. Nenhum dos 110 handlers foi chamado contra DB real nesta auditoria; autenticação/Storage/e-mail/push/deploy não foram comprovados. npm audit --omit=dev reportou 9 vulnerabilidades (7 high, 2 moderate); nenhuma dependência foi modificada.

## Estado real e lacunas

- IDENTIFICADO NO CÓDIGO não significa operacional em ambiente publicado.
- F01/F02: API suporta membership múltipla por X-Organization-Id, mas a UI lê localStorage e não foi achado seletor ou endpoint para lista de memberships. Fluxo multi-org é PARCIAL.
- F15 despesas: criação/listagem existem; fluxo de aprovar/pagar/fechar não foi encontrado.
- F20 calendário: recurrenceRule é validada, persistida e exibida; não foi achada expansão de ocorrências.
- F18 assinatura: token de 256 bits guardado como hash; expiração/limite; PDF com consentimento/evidências. Não é prova de identidade forte/certificado ICP-Brasil. Banco/Storage real não testado.
- F16 documentos: interceptor bufferiza até 100 MiB antes de serviço aplicar limite configurável (default 20 MiB). Risco de memória.
- S01 segurança: token de assinatura fica no path; Pino pode registrar URL; filtro de erro inclui originalUrl. Possível vazamento, não incidente observado.
- S05: auditoria de dependências de produção retornou 7 high/2 moderate; explorarabilidade não foi demonstrada.
- S06/S08: scanner antimalware e ensaio de backup/restore não comprovados.
- F23: exportação PDF é explicitamente rejeitada por stub; CSV está no código.
- LEGADO provável: dashboard estático não integrado à shell ativa.
- SMTP configurado no parser sem consumidor encontrado; WhatsApp apenas preenche link; push depende de browser/dispositivo real.
- Não acessamos Supabase, não confirmamos RLS/buckets/migrations aplicadas e não verificamos deploy.

## Escala e cobertura da auditoria

12 módulos de negócio + Prisma, 14 controllers/110 rotas identificados e catalogados, 16/16 áreas web descritas, 3 páginas + 1 callback localizados, 45/45 entities enumeradas (colunas detalhadas continuam no schema executável), 16 migrações listadas, 10 categorias de integração mapeadas, 155 unit tests e 21 E2E executados. Foram documentadas seis jornadas principais; zero foi comprovada ponta a ponta com serviços reais nesta auditoria.

## Prioridades

1. Comparar checkout local com branch e deploy esperados; já havia 81 arquivos rastreados alterados e 47 não rastreados antes da auditoria.
2. Corrigir exposição de tokens em URL/log/error e alinhar limites/streaming de upload.
3. Triar dependências vulneráveis com compatibilidade.
4. Confirmar migrations, RLS, buckets e backup/restore somente no projeto de desenvolvimento correto.
5. Definir UX/contrato para múltiplas organizações e completar ciclo de despesa/roles/contatos/contratos e calendário recorrente.
6. Validar SMTP, push e assinatura com dados sintéticos em ambiente isolado.
7. Atualizar docs antigas e automatizar catálogo OpenAPI.

## Preservar em próximas mudanças

Não alterar dados ou aplicar migrações sem confirmação do ambiente de desenvolvimento. Nunca usar reset, DROP, TRUNCATE. Não revelar segredos de .env. Toda operação de negócio requer organização e permissão no servidor, isolamento RLS, transação apropriada e rastreabilidade. Dinheiro permanece Decimal/string. Manter fronteiras apps/packages, TS estrito, acessibilidade, foco e layout 360px. Rever todos os itens de docs/auditoria-2026-10-27 antes de implementar; status remoto ainda está sem confirmação.
