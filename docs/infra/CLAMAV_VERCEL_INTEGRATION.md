# ClamAV na Vercel

Publicado em 22/11/2026 no projeto controle-livio-scanner, usando Container Runtime do plano Hobby. Não requer outro provedor. API e web também foram redeployadas e promovidas. Supabase permanece responsável por Database, Auth e Storage.

## Transporte e execução

O gateway HTTP roda no mesmo container que clamd; HTTPS termina na Vercel. A API autentica com Bearer privado e valida TLS. Clamd escuta apenas no loopback; sua porta TCP não é publicada. Limite de corpo: 4 MiB; uma varredura por instância. Falha de TLS, autenticação, rede, timeout ou veredito inválido bloqueia o arquivo.

As bases reais são copiadas para scratch. Cabeçalho inválido, timestamp futuro excessivo ou idade acima de 48 horas impedem varredura. FreshClam verifica atualizações sob demanda, com intervalo de seis horas. O engine anterior é encerrado antes do teste da base nova e reiniciado depois; isso evita manter dois engines simultâneos. ClamAV/FreshClam validam a base; ler o timestamp não substitui a validação criptográfica.

## Provas

HTTPS hospedado: limpo aceito, EICAR identificado, credencial incorreta 401, método inválido 404 e corpo excessivo 413. O cliente compilado da API aceitou limpo e lançou 422 para infectado.

[CI scanner 45092197283](https://github.com/steveejobs/controle-livio/actions/runs/45092197283) passou tanto o Compose HTTPS quanto o container Vercel. Este último foi limitado a 2 GiB, uma CPU, sem swap adicional, raiz somente leitura e scratch de 512 MiB. Validou varredura real e ciclo FreshClam/reinicialização, sem alterar bases assinadas. Pico medido: 1.220.866.048 bytes; inicialização fria de aproximadamente 12 s. Recursos próprios foram parados ao concluir.

A CI integrada testa também timeout/indisponibilidade, PDF e bloqueio antes de persistir documento/objeto, sempre em stack própria com dados sintéticos. Isso não equivale a executar a jornada completa em dados reais hospedados.

## Operação

Configuração, Dockerfile, manutenção e procedimento de deploy estão em [tools/scanner](../../tools/scanner/README.md). API exige gateway/token/timeout no secret manager; não registrar valores. Não usar Compose no projeto Vercel nem expor TCP clamd. O projeto scanner usa publicação manual específica; API e web preservam suas integrações Git existentes.

Monitore idade das assinaturas, falhas, latência, memória e cotas. Container Runtime é beta; o consumo pode crescer com as definições. Imagens fixadas precisam de atualização periódica. Antes de promover, testar a candidata com arquivos sintéticos e preservar o deployment anterior para rollback.

Referências: [Container Runtime](https://vercel.com/docs/functions/runtimes/container), [ClamAV Docker](https://docs.clamav.net/manual/Installing/Docker.html) e [segurança de clamd](https://docs.clamav.net/manual/Usage/Scanning.html).
