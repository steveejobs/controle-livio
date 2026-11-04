# Gateway de varredura — execução manual

Não iniciado automaticamente. Node 24, sem dependências. Executar `node tools/scanner/gateway.mjs` com `SCANNER_TOKEN` aleatório (mínimo 32 caracteres) no secret manager. Nunca passar o token na linha de comando ou em logs.

Requisitos: VM dedicada Linux 4 GiB, clamd em 127.0.0.1:3310, FreshClam ativo, limite StreamMaxLength >= 4 MiB, serviço sem privilégios, filesystem restrito, sem swap/core dumps contendo documentos. Gateway em 127.0.0.1:8080; reverse proxy HTTPS local encaminha apenas POST /scan, limite 4 MiB, buffering e logs de corpo/Authorization desativados. Firewall público permite somente 443; administração restrita. Nunca publicar 3310/8080. Configurar TLS válido, rate limit, alerta de assinaturas antigas e indisponibilidade. Não instalar agentes que capturem corpos. Verificar DPA, região e acesso do operador antes de documentos reais.

Contrato: POST /scan, Bearer, application/octet-stream; HTTP 200 application/json com exatamente {"verdict":"clean"} ou {"verdict":"infected"}. Qualquer outro resultado bloqueia. Sem armazenamento em disco, uma requisição por vez, máximo 4 MiB, timeout de leitura 9 s e daemon 8 s. Saturação retorna 503; a API não deve repetir automaticamente. Uma VM é ponto único de falha, mas indisponibilidade bloqueia uploads.

API: configurar CLAMAV_GATEWAY_URL=https://scanner.DOMINIO/scan e CLAMAV_GATEWAY_TOKEN no secret manager apenas no TEST autorizado; remover CLAMAV_HOST desse ambiente. O cliente recusa HTTP, redirects, resposta >1 KiB, JSON/veredito inválidos, status diferente de 200 e falha TLS/rede/timeout. A inspeção de PDF permanece ativa e cada conteúdo extraído também passa pelo transporte. TCP permanece disponível para CI/rede realmente privada.

Homologação externa obrigatória: TLS, token inválido, limpo, EICAR, daemon parado, timeout, JSON inválido e concorrência. Comparar contagens de documents e objetos Storage antes/depois das rejeições: delta zero. Confirmar logs sem documentos/token e rotação do segredo em ambos os lados. Testes de contrato locais não comprovam TLS/proxy/daemon hospedados.
