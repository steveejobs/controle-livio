# Candidata de publicação

O proprietário autorizou a organização e publicação na Vercel em 22/11/2026.

## Estado

A candidata funcional anterior passou os cinco jobs de CI e os seis gates locais. A organização remove históricos e artefatos da árvore ativa, preservando o runtime e os testes. As fontes de aplicação e banco não foram alteradas nesta limpeza.

A API Production está sem configuração de scanner listada na Vercel. A candidata exige ClamAV por rede privada ou gateway HTTPS autenticado. Esse bloqueio precisa ser resolvido antes de promover a API.

## Critérios

1. Validar formato, lint, TypeScript, testes, Prisma e builds da árvore final.
2. Conferir que somente fontes, dependências declaradas e assets necessários entram no upload.
3. Produzir os deployments com ambiente Production e sem trocar automaticamente os aliases.
4. Verificar inicialização, readiness e compatibilidade entre web e API.
5. Promover API e web somente após os respectivos gates.
6. Registrar URLs, identidade da versão e limitações reais da homologação.

Não aplicar migrations, reset ou seed como parte do deploy. Não desativar scanner, autorização ou isolamento para obter um build aprovado.

Ver [publicação](DEPLOYMENT.md), [homologação](HOMOLOGACAO_2026_11_22.md) e [contexto atual](../PROJECT_CONTEXT.md).
