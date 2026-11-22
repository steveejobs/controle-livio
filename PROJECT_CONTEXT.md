# Contexto do projeto Lívio

Atualizado em 22/11/2026. Este arquivo registra o estado atual. Históricos extensos e resultados de execução ficam fora do código.

## Produto e arquitetura

CRM jurídico e controle financeiro multiempresa em monorepo TypeScript estrito:

- `apps/web`: Next.js, sessão Supabase SSR, interface e tema centralizado.
- `apps/api`: NestJS, autorização por organização/permissão, operações críticas e auditoria.
- `packages/shared`: contratos, validação e regras financeiras puras.
- `packages/db`: Prisma 7.10.1, adapter-pg e pool PostgreSQL.
- `packages/ui`: componentes compartilhados.
- `supabase/migrations`: único histórico operacional de migrations.
- `tools/<domínio>`: ferramentas de manutenção e validação, fora do runtime.

Node >=24.15 <25; versão validada 24.22.3. Valores monetários usam Decimal/string. O schema não foi migrado no banco compartilhado nesta etapa.

## Organização do repositório

A pasta principal é `controle-livio`, origin `steveejobs/controle-livio`. As duas worktrees antigas foram arquivadas fora de Documents/GitHub. A pasta principal e seus pacotes foram verificados após a operação.

Nesta etapa, o proprietário autorizou limpar o projeto e publicar a versão final na Vercel. A autorização de deploy substitui as restrições históricas de publicação; não autoriza reset/migrations destrutivas ou testes de negócio no banco compartilhado.

Relatórios de auditorias antigas, CSVs/JSONs gerados, prompts históricos e dois geradores dependentes desses inventários foram arquivados fora do repositório. Os testes ativos, fixtures, decisões de arquitetura, ferramentas atuais, logos/ícones e migrations foram preservados.

Arquivo privado desta organização: `%LOCALAPPDATA%/LivioBackups/release-cleanup-20261122T211617`. Contém os históricos, snapshots dos documentos substituídos e resultados locais anteriores. O Git também preserva os arquivos anteriormente versionados.

## Validação comprovada

Candidata funcional `2f29ae9c18895edd7dce08b54036dbc807cb7d40`, merge sintético executado `86773b917eebd9a315329e519b07b53932d5a3a7`:

- Quality [45039096039](https://github.com/steveejobs/controle-livio/actions/runs/45039096039): quatro jobs PASS.
- Recovery [45039095937](https://github.com/steveejobs/controle-livio/actions/runs/45039095937): PASS.
- 491 Vitest, 208 testes Node, 42 testes de interface simulada e 17 jornadas reais de navegador.
- Financeiro 312/312, identidade/operação 43/43, escopo de cliente 10/10, recuperação 58/58.
- Storage: 64 requisições PASS; oito células não executadas não contam como aprovação.
- Recuperação coordenada COMPLETE, com 68 objetos físicos, login e API restaurados.
- PostgreSQL nativo: 15 casos PASS nas mesmas fontes de aplicação/banco.
- Formato, lint, TypeScript, Prisma, builds, OCR compilado e bundle aprovados; auditoria sem vulnerabilidades conhecidas.

Após a organização, passaram novamente formato, lint, TypeScript, 491 Vitest, Prisma Validate, builds API/web e 208 testes Node das ferramentas. Os links Markdown locais também foram conferidos sem destino quebrado. A árvore versionada passou de 602 para 514 arquivos e de 8.434.596 para aproximadamente 4.025.427 bytes. Contagens se sobrepõem e não representam cobertura universal.

## Publicação em andamento

Vercel acessível, autenticada, com dois projetos existentes em Node 24:

- API: `controle-livio`, raiz `apps/api`.
- Web: `controle-livio-web`, raiz `apps/web`.

A API Production não lista CLAMAV_HOST nem CLAMAV_GATEWAY_URL/TOKEN; ausência confirmada pelos metadados da API Vercel (33 variáveis, sem exportar valores). A candidata exige scanner em staging/production; publicar sem configurá-lo impede sua inicialização. Informações sobre um serviço existente foram solicitadas. Segredos protegidos da Vercel não são presumidos ausentes porque o CLI não os exporta. Não há configuração scanner no ambiente local; o endpoint de infraestrutura existente repetiu timeout.

A candidata ainda não foi promovida aos aliases públicos. Builds preparados devem usar produção sem atribuição automática de domínio, seguidos de verificação antes da promoção. Não desativar o scanner para liberar deploy.

## Limites de homologação

SMTP/scanner/schedulers hospedados ainda precisam de prova operacional. Dokploy repetiu timeout. Push físico, câmera, Safari/iOS e recorrência automática da agenda não foram homologados. O ensaio sintético não restaura backup histórico protegido, configurações hospedadas ou segredos.

Ver [documentação](docs/README.md), [homologação](docs/HOMOLOGACAO_2026_11_22.md) e [publicação](docs/DEPLOYMENT.md).
