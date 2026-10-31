# Visão geral — Controle Financeiro Lívio

**Data da auditoria:** 2026-10-27  
**Escopo observado:** checkout local neste diretório, incluindo alterações locais já presentes.  
**Classificação:** CONFIRMADO, IDENTIFICADO NO CÓDIGO, PARCIAL, NÃO FUNCIONAL, NÃO VERIFICADO, LEGADO e POTENCIAL descrevem o nível de evidência, não uma nota de qualidade.

## Identidade e propósito

O repositório identifica o produto como Controle Financeiro Lívio / LíVio Jurídico. A implementação procura apoiar escritórios jurídicos na operação de clientes e processos, documentos, tarefas, prazos, comunicação com clientes, contratos e recebíveis. A proposta observável é reunir CRM jurídico, fluxo de trabalho e controle financeiro por organização.

**IDENTIFICADO NO CÓDIGO:** há aplicações web e API integradas, módulos de CRM, processos, financeiro e documentos, controle multi-organização e portal com identidade de cliente. **NÃO VERIFICADO:** adequação a clientes pagantes, adoção, disponibilidade do ambiente publicado e operação ponta a ponta com serviços reais.

O usuário profissional esperado é membro de um escritório com papel de administrador, advogado, secretaria ou financeiro. Há também um perfil cliente restrito a registros vinculados. Escritório pequeno ou médio é uma hipótese compatível com a modelagem, não um segmento de mercado validado.

## Problema atendido e valor observável

O sistema conecta o cadastro inicial do cliente a processos, contratos, documentos e cobranças. Permite acompanhar etapas e tarefas, agendar compromissos, emitir documentos baseados em modelos, compartilhar mensagens e mostrar uma visão financeira baseada em recebíveis, parcelas, pagamentos e ajustes.

O diferencial técnico observável é a combinação desses domínios com escopo por organização, permissões por operação, trilha de auditoria e um portal limitado ao cliente associado. Ainda não há evidência suficiente para afirmar valor comercial, conformidade jurídica de uma assinatura eletrônica, operação de cobrança automática por WhatsApp ou prontidão para produção.

## Mapa resumido

Pessoa usuária → apps/web (Next.js; shell em /) → apps/api (NestJS; /v1) → Prisma → Supabase PostgreSQL/Auth/Storage. A API aplica guards de autenticação, limite e permissão, além de contexto da organização. O detalhamento está em 02-ARQUITETURA_TECNICA.md.

O monorepo tem os workspaces apps/api, apps/web, packages/db, packages/shared e packages/ui. A árvore também inclui migrações SQL do Supabase, ferramentas locais, documentação e workflows de CI.

## Estado em uma frase

**IDENTIFICADO NO CÓDIGO:** aplicação integrada de gestão jurídica e financeira com autenticação Supabase, API NestJS, web Next.js, schema Prisma e histórico SQL Supabase. Testes unitários e E2E mockados, lint, tipos, validação Prisma, build e verificação de bundle foram executados nesta auditoria e passaram; auditoria npm encontrou alertas transitivos. **NÃO VERIFICADO:** banco remoto, publicação atual, SMTP, push real, restauração de backup, integrações reais e fluxos autenticados completos entre navegador, API, banco e Storage.

## Limites desta auditoria

- Não houve conexão com banco remoto ou inspeção de registros de clientes.
- Não foram aplicadas migrações, alterados dados, publicados artefatos nem instaladas dependências.
- Testes E2E exercitaram a interface com chamadas de API interceptadas; não provam operação real do backend.
- O repositório já tinha 81 arquivos rastreados modificados e 47 não rastreados antes dos documentos desta auditoria. Esta leitura representa o checkout local, não necessariamente HEAD, release ou ambiente implantado.
- PROJECT_CONTEXT.md contém histórico de QA e implantação em homologação. Esse histórico foi tratado como evidência documental preexistente e não como verificação repetida nesta auditoria.

## Fontes principais

README.md, PROJECT_CONTEXT.md, docs/, apps/api/src, apps/web/app, apps/web/features, packages/db/prisma/schema.prisma, supabase/migrations, tools/ e workflows em .github/workflows.
