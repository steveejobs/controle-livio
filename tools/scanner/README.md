# Serviço de varredura

O código final inclui ClamAV 1.5.4, gateway Node 24 e proxy HTTPS Caddy em `compose.yaml`. Imagens oficiais têm digest fixado. O serviço executa fora da Vercel; atualizar o Git da API/web não cria um servidor Docker.

## Servidor

Use Linux com Docker Compose 2.24+, preferencialmente 4 GiB de RAM disponíveis, DNS do scanner apontando para esse host e porta 443 livre. Não substitua nem pare um proxy existente para liberar a porta. O pacote é um serviço dedicado; um host com proxy existente exige integração própria.

ClamAV/FreshClam compartilham rede privada com gateway/proxy. O gateway continua escutando somente em loopback; não há publicação das portas 3310/8080. Só HTTPS é publicado, inicialmente em 127.0.0.1. Assinaturas e certificados ficam em volumes persistentes; documentos são tratados em memória e não são gravados em disco.

## Preparar

Copie `scanner.env.example` para um arquivo privado fora do repositório, com acesso restrito ao operador:

- `SCANNER_DOMAIN`: hostname real do scanner, com DNS configurado.
- `SCANNER_TOKEN`: segredo aleatório de pelo menos 32 caracteres, gerado no secret manager.
- `SCANNER_BIND_ADDRESS=0.0.0.0`: habilita explicitamente a exposição HTTPS.
- `SCANNER_HTTPS_PORT=443`: necessária para a validação TLS automática do pacote padrão.

Não usar placeholders como credenciais. Não imprimir o Compose resolvido: ele inclui o segredo. Na raiz do checkout no servidor:

```text
docker compose --project-name livio-scanner --env-file /private/livio-scanner.env -f tools/scanner/compose.yaml config --quiet
docker compose --project-name livio-scanner --env-file /private/livio-scanner.env -f tools/scanner/compose.yaml up --detach --build --wait --wait-timeout 480
```

O Caddy obtém e renova o certificado. A emissão pública depende de DNS e acesso externo corretos. Mantenha alertas para indisponibilidade e assinaturas desatualizadas; atualize periodicamente as imagens para patches de segurança.

## Conectar à API Vercel

No projeto API, configure em Production:

- `CLAMAV_GATEWAY_URL=https://SEU_HOSTNAME/scan`.
- `CLAMAV_GATEWAY_TOKEN`: o mesmo segredo de `SCANNER_TOKEN`.
- Não configurar `CLAMAV_HOST` com IP público; TCP clamd não autentica nem cifra.

Faça um novo deployment com `--prod --skip-domain`, verifique a API e o scanner e só então promova. O build Vercel executa `release:environment`; configuração incompleta falha antes da publicação. A checagem não imprime os valores das credenciais.

## Contrato e verificação

Somente POST /scan com Bearer e corpo binário, até 4 MiB. Resposta 200 com exatamente `{"verdict":"clean"}` ou `{"verdict":"infected"}`. Erro de autenticação, JSON, TLS, daemon, rede ou timeout bloqueia o arquivo. Uma requisição de varredura por vez; saturação retorna 503. Nenhum log de corpo ou Authorization é habilitado no proxy.

A workflow `Scanner deployment package` valida a composição real em Linux descartável: imagens fixadas, HTTPS com CA privada de teste, autenticação, tamanho, EICAR, cliente compilado da API, pausa/retomada do daemon e certificados não confiáveis. Ela usa somente dados sintéticos e para apenas seus containers próprios; não implanta em servidor persistente. O certificado de teste não é usado em produção.

A aprovação CI não comprova DNS, TLS público ou disponibilidade de um servidor ainda não configurado. Antes de dados reais, valide o serviço hospedado e confira que rejeições não criam documento/objeto Storage.

Referências: [ClamAV Docker e requisitos](https://docs.clamav.net/manual/Installing/Docker.html), [redes Compose](https://docs.docker.com/compose/how-tos/networking/) e [HTTPS automático Caddy](https://caddyserver.com/docs/automatic-https).
