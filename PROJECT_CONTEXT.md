# Contexto do projeto Lívio

Atualizado em 22/11/2026. Este arquivo registra o estado atual. Históricos extensos e resultados de execução ficam fora do código.

## Infraestrutura confirmada pelo proprietário

O proprietário esclareceu que dispõe somente de Vercel e Supabase, sem outro servidor. Não assumir um host Docker/Dokploy disponível nem tratar sua contratação como requisito já aceito. O pacote Compose abaixo foi validado em CI, mas sua implantação proposta não corresponde à infraestrutura informada e não resolve sozinho a publicação.

A Vercel oferece Container Runtime em beta e o plano consultado é Hobby. Foi criado o projeto `controle-livio-scanner` na mesma conta Vercel, sem upgrade nem outro provedor, com ClamAV real e gateway autenticado. O primeiro deployment `dpl_8nBQ9RMaf4SH5ReBWndwb9d6L2Qc` chegou a READY e foi promovido somente no projeto scanner: HTTPS hospedado aceitou arquivo sintético limpo, identificou EICAR e negou token incorreto (401). O cliente compilado da API aceitou limpo e rejeitou EICAR com 422. Chamadas iniciais levaram aproximadamente 13 segundos. Configuradas na API Production somente as chaves gateway/token/timeout necessárias, sem registrar seus valores. O redeploy da API e sua promoção ainda precisam ser concluídos.

Implementado Dockerfile próprio da Vercel, gateway reutilizável, listener HTTP atrás do TLS da plataforma e inicialização do engine. Definições reais são copiadas para scratch, com verificação do timestamp no cabeçalho CVD e recusa após 48 horas. Checagens de atualização são feitas sob demanda, parando o engine antes do load-test FreshClam e retomando a varredura depois; não carregar dois engines simultaneamente. Adicionada homologação CI com 2 GiB/uma CPU, raiz somente leitura e scratch limitado, incluindo ciclo de atualização; resultado ainda pendente. Quatro regressões de cabeçalho foram adicionadas e precisam passar. A recomendação oficial de 3–4 GiB exige comprovar consumo também nesse ciclo, não apenas a primeira varredura.

Referências consultadas: [Container Runtime Vercel](https://vercel.com/docs/functions/runtimes/container), [limites Functions](https://vercel.com/docs/functions/limitations), [ClamAV Docker](https://docs.clamav.net/manual/Installing/Docker.html) e [limites Edge Functions Supabase](https://supabase.com/docs/guides/functions/limits). A publicação final da API/web ainda não foi concluída; o scanner hospedado já tem prova real inicial. Nenhuma proteção de arquivos foi desativada. A proteção de login da Vercel foi removida apenas do novo projeto scanner, cujo acesso exige Bearer próprio; os projetos existentes não tiveram essa proteção alterada.

## Pacote Compose ClamAV — validado somente em CI

O proprietário pediu incluir o antivírus na versão que será atualizada pelo Git. Incluídos Compose com ClamAV 1.5.4/FreshClam, gateway Node 24 e HTTPS Caddy; imagens oficiais fixadas por digest, default de publicação em loopback e nenhuma porta pública clamd/8080. O pacote precisa de host Docker e DNS próprios; não é executado automaticamente pela Vercel.

A API Vercel passa a executar `release:environment` após compilar: configuração incompleta impede um build READY e preserva o alias anterior. A validação exige runtime Production, destino staging/production remoto e scanner; erros são sanitizados para não expor credenciais. Quatro regressões locais passaram, incluindo ausência de scanner, bypass local rejeitado e erro com URL secreta.

A workflow dedicada Scanner deployment package testa a composição em Linux descartável com TLS real de CA privada de teste, ClamAV/EICAR reais, limites, autenticação, cliente compilado da API e pausa/retomada do daemon. Não toca banco, infraestrutura persistente ou destinatários externos. Gates locais completos PASS: formato, lint, release check, TypeScript, 491 Vitest, Prisma, builds e 215 testes Node.

Candidata final do código: `482650af4bffcdecb43b6e222df94b35eb8dbb5f`. Quality [45078508272](https://github.com/steveejobs/controle-livio/actions/runs/45078508272) 4/4 PASS, recovery [45078508226](https://github.com/steveejobs/controle-livio/actions/runs/45078508226) PASS e pacote scanner [45078508364](https://github.com/steveejobs/controle-livio/actions/runs/45078508364) PASS: oito grupos de checks reais, ClamAV 1.5.4, TLS, EICAR, cliente da API, falha fechada e retomada. `/tmp` e `/var/tmp` do scanner usam tmpfs; core dumps desativados. Recursos próprios CI parados ao concluir. A primeira candidata 038159a também aprovou o pacote; seus runs Quality/recovery foram cancelados em favor da versão final.

O novo gate foi confirmado na própria Vercel: deployment `dpl_J3nsi54tvjgDwPz2qrdbQDAXhNgQ` rejeitou o build em `release:environment`, exclusivamente por configuração ClamAV ausente, em vez de chegar a READY com startup quebrado. Esse gate e a configuração API não mudaram entre 038159a e 482650a. Nenhum alias público foi promovido; web e API ready anteriores continuam 200 nas verificações anteriores. O endpoint Dokploy consultado repetiu timeout; o proprietário esclareceu depois que não dispõe de outro servidor. A proposta anterior de hospedagem externa não está aprovada. Nenhuma hospedagem paga foi contratada, migration aplicada ou proteção desativada.

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

## Publicação preparada — bloqueio de infraestrutura

Candidata executável final `b2a8b88a820aeedc0d895c1dc3a45ec06c86ba1a`. Quality [45073129619](https://github.com/steveejobs/controle-livio/actions/runs/45073129619) 4/4 PASS e recovery [45073129613](https://github.com/steveejobs/controle-livio/actions/runs/45073129613) 1/1 PASS. Merge CI `31acc7959c62825a399bcbb180e9952190baf094` e candidata têm a mesma árvore Git `8b9bbcdc508c6c9de98c912956e5c8f97840b5bd`. A nova guarda de upload acrescenta três testes aos 208 existentes e preserva 474 fontes versionadas. A árvore final tem 517 arquivos; 514 era o estado após a limpeza inicial, antes da guarda.

Os dois deployments Production foram preparados com `--skip-domain`: API `dpl_6yzAidzz8i7Vd1ny2kyxbEcy8fiq` e web `dpl_HEFVgHkPY6NHh5sskU2sL7K5ZrE8`, ambos READY de build. A web preparada respondeu 200 em `/`, `/reset-password` e `/sw.js`. A API preparada retornou 500 em live/ready; o log confirmou ZodError por ClamAV ausente, sem erro de módulo. Não houve promoção aos aliases públicos nem merge em main. Web pública e API ready anteriores seguem 200; clients sem login retorna 401.

A publicação final depende de resolver a execução do scanner na infraestrutura disponível e testá-lo hospedado. A busca anterior nas conexões não encontrou um scanner utilizável; o proprietário esclareceu que possui somente Vercel e Supabase. A hipótese de recuperar um servidor Dokploy não deve ser tratada como infraestrutura confirmada. Nenhum serviço novo pago foi contratado. Não contornar a validação nem apontar o scanner para endereço fictício.

A primeira preparação Vercel do commit de limpeza 6bea0db revelou uma exclusão indevida: `reports/` sem âncora retirava também os módulos API/web de relatórios. Nenhum alias público foi promovido. Regras corrigidas para `/reports/` e demais pastas de artefatos na raiz; `release:check` verifica as fontes versionadas contra `.vercelignore` isoladamente, com três regressões Git reais e execução na CI. O código dos módulos permaneceu intacto.

Busca de infraestrutura existente: Vercel sem variáveis scanner, ambiente local sem scanner, Cloudflare sem zonas e sem Worker relacionado, servidor Dokploy sem resposta nas portas de administração/HTTPS verificadas. Nenhum serviço ClamAV existente foi identificado nas conexões disponíveis; nenhum recurso pago novo foi criado.

Vercel acessível, autenticada, com dois projetos existentes em Node 24:

- API: `controle-livio`, raiz `apps/api`.
- Web: `controle-livio-web`, raiz `apps/web`.

A API Production não lista CLAMAV_HOST nem CLAMAV_GATEWAY_URL/TOKEN; ausência confirmada pelos metadados da API Vercel (33 variáveis, sem exportar valores). A candidata exige scanner em staging/production; publicar sem configurá-lo impede sua inicialização. Informações sobre um serviço existente foram solicitadas. Segredos protegidos da Vercel não são presumidos ausentes porque o CLI não os exporta. Não há configuração scanner no ambiente local; o endpoint de infraestrutura existente repetiu timeout.

A candidata ainda não foi promovida aos aliases públicos. Builds preparados devem usar produção sem atribuição automática de domínio, seguidos de verificação antes da promoção. Não desativar o scanner para liberar deploy.

## Limites de homologação

SMTP/scanner/schedulers hospedados ainda precisam de prova operacional. Dokploy repetiu timeout. Push físico, câmera, Safari/iOS e recorrência automática da agenda não foram homologados. O ensaio sintético não restaura backup histórico protegido, configurações hospedadas ou segredos.

Ver [documentação](docs/README.md), [homologação](docs/HOMOLOGACAO_2026_11_22.md) e [publicação](docs/DEPLOYMENT.md).
