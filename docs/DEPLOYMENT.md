# Publicação

A web e a API são dois projetos Vercel do mesmo monorepo. Supabase é o destino persistente e não é recriado durante o deploy.

## Projetos

| Serviço     | Projeto            | Root Directory | Runtime   |
| ----------- | ------------------ | -------------- | --------- |
| API NestJS  | controle-livio     | apps/api       | Node 24.x |
| Web Next.js | controle-livio-web | apps/web       | Node 24.x |

Requisitos do código: Node >=24.15 <25; homologação em 24.22.3. Habilite fontes externas à Root Directory. Build/install vêm dos respectivos `vercel.json`. A API usa preset NestJS, Fluid compute e região `cle1`; a web usa o adaptador Next.js nativo.

## Configuração

Cadastre valores no secret manager da Vercel. Não copie o `.env` local para o upload.

A API exige configuração coerente de Database/Supabase, ref e confirmação, ambiente staging/production, origens HTTPS, redirect Auth, bucket e scanner. A lista completa e os limites estão em `packages/shared/src/environment.ts`; `.env.example` documenta os nomes.

Para scanner, configure um dos transportes:

- `CLAMAV_HOST` em uma rede realmente privada e acessível à API.
- `CLAMAV_GATEWAY_URL` HTTPS e `CLAMAV_GATEWAY_TOKEN`, com certificado válido e autenticação.

Não exponha o TCP clamd publicamente. Veja [o gateway](../tools/scanner/README.md). Timeout, indisponibilidade ou veredito inválido devem bloquear o arquivo.

A web recebe somente `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Use a URL pública estável da API com `/v1`.

Segredos protegidos não são necessariamente exportáveis pelo CLI. Uma linha vazia no arquivo de `vercel env pull` não comprova segredo ausente no runtime; confira os metadados e valide o deployment.

## Gate local

```text
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run db:validate
npm run build
```

A CI deve validar também Auth/RLS/Storage, financeiro concorrente, navegador integrado, scanner, email de captura e recuperação descartável. Consulte [a homologação](HOMOLOGACAO_2026_11_22.md). Não executar testes de escrita com credenciais do banco compartilhado.

## Preparação e promoção

1. Registre a versão Git e os deployments atuais para rollback.
2. Selecione explicitamente o projeto API ou web ao trabalhar na raiz do monorepo; confira o project ID e a Root Directory.
3. Crie um deployment com ambiente Production sem trocar os domínios:

```text
vercel deploy --prod --skip-domain --yes
```

4. Aguarde build e verifique inicialização, `/v1/health/live`, `/v1/health/ready`, acesso sem login negado, web e compatibilidade de origens.
5. Valide upload limpo/infectado/indisponibilidade em uma organização de homologação autorizada, além de login, recuperação, navegação e isolamento.
6. Promova somente o deployment aprovado:

```text
vercel promote <deployment-url> --yes
```

O uso de `--skip-domain` e promoção posterior segue [a documentação Vercel](https://vercel.com/docs/cli/deploy). READY de build não comprova que a API iniciou nem que o scanner está acessível.

## Banco, email e agendamentos

Não aplicar migrations, reset ou seed como efeito do deploy. Mudanças de banco exigem procedimento próprio e confirmação de destino DEV; nunca restaurar sobre o projeto persistente.

Convite e recuperação dependem do SMTP/Supabase Auth e de redirects corretos. Entrega externa precisa de prova específica. Cron diário usa Bearer CRON_SECRET; dispatch de lembretes usa autenticação HMAC. Ativar scheduler ou limpeza Storage exige configuração e autorização próprias. Push depende de VAPID e dispositivo inscrito.

## Artefatos e rollback

`.vercelignore` exclui segredos locais, relatórios, documentação, caches e builds locais. Instalação limpa gera Prisma/metadados e os builds na Vercel. Preserve os assets documentais e OCR necessários.

Em falha de inicialização ou de fluxos críticos, mantenha o alias anterior. Se a promoção já ocorreu, reverta ao deployment anterior compatível; mudanças de banco não são revertidas automaticamente com o código.

## Estado atual

Publicação autorizada em 22/11/2026. A API Production não lista configuração ClamAV; a candidata não deve ser promovida sem resolver e testar essa dependência. Não desativar o scanner para contornar o gate.
