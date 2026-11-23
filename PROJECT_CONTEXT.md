# Contexto do projeto Lívio

Atualizado em 22/11/2026 (São Paulo). Este documento registra o estado atual; evidências brutas ficam fora do código.

## Publicação efetivada na Vercel

O proprietário autorizou organização, testes e publicação. A infraestrutura confirmada é somente Vercel e Supabase. O bloqueio ClamAV foi resolvido sem outro provedor, upgrade de plano, bypass de segurança ou migration no banco compartilhado.

API, web e scanner chegaram a READY, foram verificados isoladamente e promovidos. A API Vercel confirmou que os três aliases apontam para os deployments esperados:

| Serviço        | Endereço público                          | Deployment                       |
| -------------- | ----------------------------------------- | -------------------------------- |
| API NestJS     | https://controle-livio.vercel.app         | dpl_86K8FWST1RfT1PYeKWderX6JwTbH |
| Web Next.js    | https://controle-livio-web.vercel.app     | dpl_3HyoJ3c1nLV5dnmPYpaEmUgpDZ3o |
| Scanner ClamAV | https://controle-livio-scanner.vercel.app | dpl_2xXJ61LHo3NrJa6yh4Wxrr97erhM |

Após promoção: API live/ready 200, clients sem login 401; web, reset-password e sw.js 200; preflight API 204 com origem pública da web correta. Chrome real em 360/1280 px: formulário carregado, foco por teclado, zero overflow e zero erros JavaScript. Esses probes não executam operações de negócio com dados reais.

As fontes publicadas de API/web são as de dcdcbdf; o scanner é fc4bbac. Comparação Git confirmou igualdade das respectivas fontes executáveis com 7da4a69, que alterou somente a ferramenta CI depois de fc4bbac. Branch ativa fix/runtime-security-20261122; PR #4 permanece aberto; main não foi alterada nesta etapa.

## Scanner no plano atual

Criado o projeto controle-livio-scanner na mesma conta Vercel Hobby, usando Container Runtime beta. Dockerfile.vercel combina imagens oficiais fixadas de Node 24 e ClamAV 1.5.4. O gateway exige Bearer próprio; TLS é terminado pela Vercel e clamd escuta apenas no loopback do container. A proteção de login Vercel foi removida somente desse novo projeto para permitir chamadas autenticadas da API; as proteções dos projetos existentes foram preservadas.

Configuradas no secret manager API Production as chaves CLAMAV_GATEWAY_URL, CLAMAV_GATEWAY_TOKEN e CLAMAV_TIMEOUT_MS. Nenhum valor ou segredo é registrado aqui. O build mantém release:environment obrigatório.

A raiz pode ser somente leitura; assinaturas são copiadas para scratch. Cabeçalhos CVD inválidos, excessivamente futuros ou mais antigos que 48 horas são recusados. FreshClam verifica atualizações sob demanda com intervalo de seis horas; o engine anterior é parado antes do load-test da base e reiniciado em seguida. Um sinal operacional local permite verificar o mesmo ciclo na CI, sem expor endpoint de manutenção. Rede/TLS/timeout/base inválida/veredito inválido continuam bloqueando arquivos. Não há serviço externo recebendo documentos.

HTTPS hospedado aceitou limpo, identificou EICAR, negou token incorreto (401), método incorreto (404) e tamanho excedido (413). O cliente compilado da API aceitou limpo e lançou 422 para EICAR. A versão ajustada respondeu em aproximadamente 0,4–0,7 s nas chamadas verificadas; inicialização fria isolada levou aproximadamente 12 s. Essas medições não garantem latência universal.

Scanner deployment package [45092197283](https://github.com/steveejobs/controle-livio/actions/runs/45092197283): PASS. Compose HTTPS original aprovado e container Vercel aprovado com 2 GiB, uma CPU, sem swap adicional, raiz somente leitura e scratch limitado a 512 MiB. Testou EICAR real, autenticação, tamanho e ciclo FreshClam/reinicialização, sem alterar as bases do fornecedor. Pico medido: 1.220.866.048 bytes; recursos próprios CI parados ao concluir. Quatro regressões de cabeçalho passaram.

O Compose anterior é uma opção separada de host Docker; não é a implantação usada. O projeto scanner não tem deploy automático Git conectado: alterações nele exigem deploy específico. Supabase permanece responsável por Database, Auth e Storage.

## Arquitetura e regras

Monorepo TypeScript estrito: apps/web (Next.js/SSR/tema), apps/api (NestJS/autorização/auditoria), packages/shared (contratos/regras), packages/db (Prisma 7.10.1/adapter-pg), packages/ui e tools por domínio. Node validado 24.22.3, requisito >=24.15 <25. Dinheiro usa Decimal/string. Toda operação de negócio exige organização autenticada e permissão. Não executar migrations, reset ou testes de escrita genéricos no banco compartilhado sob autorização de deploy.

Preservadas correções anteriores de precisão Decimal, SQLSTATE/unique, retry serializável limitado, descarte de conexão após rollback e confiança TLS Supabase. A guarda release:check impede que .vercelignore exclua módulos versionados, incluindo relatórios. Nenhuma regra financeira ou asserção de isolamento foi relaxada para aprovar testes.

## Validação

Gates locais completos PASS: formato, lint, release check, TypeScript, 491 Vitest, Prisma, builds API/web e 219 testes Node. Formato/lint foram repetidos após o último ajuste da ferramenta de ensaio.

Versão validada 7da4a69c137718ed5a8c9a1078f406ad37e24f79: Quality [45092197197](https://github.com/steveejobs/controle-livio/actions/runs/45092197197) 4/4 PASS, recuperação [45092197219](https://github.com/steveejobs/controle-livio/actions/runs/45092197219) PASS e scanner [45092197283](https://github.com/steveejobs/controle-livio/actions/runs/45092197283) PASS. Os seis jobs passaram na mesma versão. A execução anterior fc4bbac também aprovou Quality 4/4 e recuperação; as duas falhas anteriores no ensaio auxiliar scanner foram corrigidas sem relaxar suas verificações. Todos esses jobs usam ambientes próprios e dados sintéticos.

A homologação funcional anterior comprovou 42 testes de interface simulada, 17 jornadas reais, financeiro 312, identidade/operação 43, escopo de cliente 10 e recuperação 58. Storage teve 64 requisições aprovadas e oito células não executadas. Contagens se sobrepõem e não são percentual de cobertura. Ver docs/HOMOLOGACAO_2026_11_22.md para evidências e limites.

## Organização e evidências

Principal: controle-livio, origin steveejobs/controle-livio. Duas worktrees antigas foram arquivadas fora de Documents/GitHub. Históricos, prints e resultados gerados foram retirados da árvore ativa; fontes, fixtures, assets necessários e migrations foram preservados. Arquivo privado: %LOCALAPPDATA%/LivioBackups/release-cleanup-20261122T211617. Novas evidências e referência de rollback ficam em pasta temporária privada fora do repositório; nenhum segredo foi publicado em artefatos.

## Limites remanescentes

Os probes hospedados não substituem jornada autenticada completa com dados reais nem ensaio de carga contínua. SMTP externo, push físico, câmera, Safari/iOS e recorrência automática da agenda não foram homologados. O ensaio de recuperação sintético não restaura backup histórico protegido, segredos ou configuração hospedada. Container Runtime ainda é beta e o consumo deve ser monitorado conforme as bases crescem. Não prometer ausência universal de defeitos.

Ver [documentação](docs/README.md), [homologação](docs/HOMOLOGACAO_2026_11_22.md) e [publicação](docs/DEPLOYMENT.md).
