# Instruções permanentes do repositório

Leia `PROJECT_CONTEXT.md` e os documentos em `docs/` antes de alterar arquitetura, banco, segurança, UI ou ferramentas. Ao concluir uma etapa relevante, atualize `PROJECT_CONTEXT.md` com estado real, decisões, validações e riscos; não registre segredos nem valores de `.env`.

## Regras de implementação

- Preserve o monorepo TypeScript estrito e os limites entre `apps` e `packages`.
- Componentes devem ser pequenos, semânticos, acessíveis e agrupados por domínio; dados estáticos ficam fora da renderização.
- Tokens, motion e estilos transversais pertencem a `apps/web/theme`. Não espalhe cores, timings ou breakpoints sem necessidade.
- Motion fora da abertura usa `opacity`/`transform`, 560–680 ms, deslocamento discreto, observer compartilhado e fallback para `prefers-reduced-motion`.
- Toda operação de negócio da API exige organização autenticada e permissão explícita. Dinheiro é Decimal/string, nunca ponto flutuante nativo.
- Ferramentas locais vivem em `tools/<dominio>`, são seguras por padrão, documentadas e não sobrescrevem originais sem opção explícita.
- Não aplicar migrations sem confirmação de banco de desenvolvimento. Nunca usar reset, DROP, TRUNCATE ou comandos destrutivos.
- Antes da entrega, executar format check, lint, TypeScript, testes, validação Prisma e builds.

## Qualidade de UI/UX

Manter navegação por teclado, foco visível, alvos confortáveis, contraste, estados de carregamento/erro e layout sem overflow em 360 px. Interações de ponteiro são aprimoramento: nunca escondem conteúdo, não substituem foco e devem ser desativadas com movimento reduzido.
