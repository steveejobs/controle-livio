# Candidata de publicação

O proprietário autorizou a organização e publicação na Vercel em 22/11/2026.

## Estado

A candidata funcional anterior passou os cinco jobs de CI e os seis gates locais. A organização remove históricos e artefatos da árvore ativa, preservando o runtime e os testes. As fontes de aplicação e banco não foram alteradas nesta limpeza.

O bloqueio ClamAV foi resolvido com Container Runtime no projeto controle-livio-scanner, na mesma Vercel Hobby. Gateway/token/timeout foram configurados na API Production; o build passou. Scanner, API e web foram promovidos, e os três aliases públicos foram conferidos contra os deployments esperados. Não houve outro provedor, upgrade ou migration no banco compartilhado.

Probes públicos: API live/ready 200, clients sem login 401, web/reset/worker 200 e CORS 204. Chrome real validou formulário, teclado e ausência de overflow em 360/1280 px, sem erros JavaScript. Scanner HTTPS aceitou limpo, detectou EICAR e recusou autenticação/tamanho/método inválidos. O cliente compilado da API rejeitou o infectado com 422. A CI aprovou atualização FreshClam/reinicialização sob 2 GiB, com pico de aproximadamente 1,14 GiB.

## Critérios

1. Validar formato, lint, TypeScript, testes, Prisma e builds da árvore final.
2. Conferir que somente fontes, dependências declaradas e assets necessários entram no upload.
3. Produzir os deployments com ambiente Production e sem trocar automaticamente os aliases.
4. Verificar inicialização, readiness e compatibilidade entre web e API.
5. Promover API e web somente após os respectivos gates.
6. Registrar URLs, identidade da versão e limitações reais da homologação.

Não aplicar migrations, reset ou seed como parte do deploy. Não desativar scanner, autorização ou isolamento para obter um build aprovado.

Ver [publicação](DEPLOYMENT.md), [homologação](HOMOLOGACAO_2026_11_22.md) e [contexto atual](../PROJECT_CONTEXT.md).
