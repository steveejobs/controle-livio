# ClamAV: CI real e proposta para Vercel

**Estado em 2026-10-30: implementação local preparada; scanner real ainda não executado nesta revisão.** Nenhum serviço cloud, variável de produção ou projeto Vercel foi alterado.

## CI isolado

O workflow inicia a imagem oficial `clamav/clamav:stable` em container temporário. A porta `3310` fica publicada somente em `127.0.0.1:13310` do runner GitHub; o container não publica `clamd` em interface externa. A imagem pode buscar assinaturas atualizadas. O job testa arquivo limpo, EICAR, timeout com daemon pausado, indisponibilidade com o container parado e upload infectado pelo formulário real. O teste de upload espera HTTP 422 e confirma que o registro não foi criado.

Durante a jornada integrada, Auth/PostgreSQL/Storage continuam locais. A API usa `SUPABASE_ENVIRONMENT=staging` e `SUPABASE_LOCAL=true` somente no processo de teste para exercitar scanner em vez do bypass. O bypass permanece limitado ao par `SUPABASE_ENVIRONMENT=test` + `SUPABASE_LOCAL=true`. O serviço e a API do teste ficam no runner descartável; nenhuma variável de produção é configurada.

O protocolo TCP `clamd` não autentica nem cifra tráfego. Portanto a exposição loopback do CI é obrigatória e não pode ser substituída por uma porta pública. A documentação do ClamAV alerta explicitamente contra expor esse TCP à internet.

## Proposta de hospedagem compatível com Vercel

1. Manter `clamd` em container/VM de rede privada, aceitando conexões apenas do serviço scanner. Não abrir a porta 3310 ao público. O scanner deve atualizar definições, limitar memória/concorrência e emitir métricas e alertas de disponibilidade.
2. Não conectar uma Function Vercel diretamente ao TCP não autenticado do ClamAV. Criar um gateway HTTPS de varredura que valide identidade da Function (mTLS ou token assinado de curta duração), valide tamanho e tempo, encaminhe o conteúdo ao `clamd` pela rede privada e responda somente com veredito e identificador. TLS termina no gateway; segredos e conteúdo nunca entram em logs.
3. Antes de escolher rede, confirmar plano, região e conectividade disponíveis na conta Vercel. Secure Compute fornece rede privada dedicada para Functions no Enterprise; Static IPs permitem allowlist de saída, mas não equivalem a rede privada. Para scanner hospedado na AWS, verificar se PrivateLink/Advanced Networking está disponível para os projetos atuais. As opções têm custos e escopos distintos e não foram contratadas.
4. Preservar o comportamento fail-closed: erro de rede, identidade, TLS, timeout ou resposta inválida impede gravação/liberação do documento. Monitorar latência de scan e falhas; ter alerta antes de habilitar upload do primeiro escritório.
5. A API Vercel limita corpo de request/response de Function a 4,5 MB. O limite de arquivo atual é 4 MiB; o multipart completo precisa ser medido abaixo de 4,5 MB. Para arquivos maiores, usar upload direto para quarentena privada com ticket curto e vinculado ao tenant; um worker varre o objeto e só então o move/libera. O browser não pode obter URL de leitura enquanto o estado estiver em quarentena.
6. Validar em homologação limpa, EICAR, timeout, indisponibilidade, assinatura desatualizada, pico de concorrência, cleanup de quarentena e negação de download. A passagem no CI não substitui configuração e teste de rede dos dois projetos Vercel.

Referências: [protocolo e segurança de clamd](https://docs.clamav.net/manual/Usage/Scanning.html), [imagens Docker oficiais](https://docs.clamav.net/manual/Installing/Docker.html), [limite de payload de Vercel Functions](https://vercel.com/docs/functions/limitations), [Secure Compute e Static IPs](https://vercel.com/kb/guide/can-i-get-a-fixed-ip-address) e [PrivateLink/egress](https://vercel.com/academy/optimize-your-vercel-account/backend-egress).
