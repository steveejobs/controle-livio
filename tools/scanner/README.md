# Serviço de varredura

O pacote Compose inclui ClamAV 1.5.4, gateway Node 24 e proxy HTTPS Caddy. Imagens oficiais têm digest fixado. Sua execução foi validada em CI Linux com Docker; não foi validada na Vercel ou no Supabase. O proprietário confirmou que dispõe somente dessas duas plataformas, sem host Docker adicional. Os passos abaixo descrevem a opção de host dedicado e não uma infraestrutura existente ou contratação autorizada.

A implantação na Vercel usa `Dockerfile.vercel` e `vercel.json`, separadamente do Compose. O [Container Runtime em beta](https://vercel.com/docs/functions/runtimes/container) segue os limites de Functions.

## Vercel

O projeto `controle-livio-scanner` usa esta pasta como raiz, preset Container e região próxima à API. Configure `SCANNER_TOKEN` no secret manager do projeto. O gateway usa `PORT`, escuta HTTP dentro do container e a Vercel termina HTTPS; clamd continua restrito ao loopback. Não enviar `scanner.env`, `.env` ou qualquer credencial no upload.

Na raiz desta pasta, selecione explicitamente o projeto scanner e faça `vercel deploy --prod --skip-domain --yes`. Teste com credencial válida, token incorreto, arquivo sintético limpo e EICAR; confirme que o cliente compilado da API lança 422 para o infectado. Só então promova o scanner. Configure `CLAMAV_GATEWAY_URL` com `/scan`, `CLAMAV_GATEWAY_TOKEN` e um `CLAMAV_TIMEOUT_MS` que comporte a inicialização fria, respeitando o limite do schema da API. Faça o redeploy da API depois dessa configuração.

As definições incluídas na imagem são copiadas para `/tmp/clamav`; a raiz pode ser somente leitura. O cabeçalho CVD precisa identificar uma base ClamAV válida e atualizada nas últimas 48 horas. Após seis horas, a próxima varredura verifica atualizações usando FreshClam; o engine anterior é parado antes de testar a base e reiniciado em seguida para evitar dois engines simultâneos. Erros, base vencida e timeout bloqueiam o arquivo. Não há envio dos documentos para serviço de terceiros.

`verify-vercel-ci.mjs` verifica o container real com 2 GiB de memória, sem swap adicional, uma CPU, raiz somente leitura e scratch de 512 MiB. Inclui varredura real e ciclo de FreshClam/reinicialização. Não confundir essa prova isolada com homologação completa da API publicada. O projeto scanner não foi conectado a deploy automático Git nesta etapa; alterações exigem novo deploy específico.

## Servidor

Use Linux com Docker Compose 2.24+, preferencialmente 4 GiB de RAM disponíveis, DNS do scanner apontando para esse host e porta 443 livre. Não substitua nem pare um proxy existente para liberar a porta. O pacote é um serviço dedicado; um host com proxy existente exige integração própria.

ClamAV/FreshClam compartilham rede privada com gateway/proxy. O gateway continua escutando somente em loopback; não há publicação das portas 3310/8080. Só HTTPS é publicado, inicialmente em 127.0.0.1. Assinaturas e certificados ficam em volumes persistentes. O gateway mantém o corpo em memória; `/tmp` e `/var/tmp` do ClamAV usam tmpfs. Core dumps estão desativados; desative swap no host para evitar paginação dos buffers.

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
