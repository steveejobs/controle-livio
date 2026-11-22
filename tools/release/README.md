# Publicação

`npm run release:check` verifica as fontes versionadas contra `.vercelignore` usando
o interpretador de padrões do Git, sem combinar regras de `.gitignore`. Não altera
arquivos, configurações, deployments ou dados.

Recusa excluir arquivos de `apps`, `packages`, `supabase`, `tools` e configurações
necessárias ao build. A regra `/reports/` exclui artefatos da raiz; `reports/` também
atinge módulos da aplicação e deve falhar. As regressões reproduzem esse erro com
repositórios Git sintéticos, incluindo negações independentes de `.gitignore`.

```text
npm run release:check
node --test tools/release/verify-upload.test.mjs
```

Antes do deploy, confira também [o roteiro](../../docs/DEPLOYMENT.md). Essa verificação
não valida credenciais, runtime remoto, scanner ou permissões do banco.
