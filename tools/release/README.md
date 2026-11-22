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

`npm run release:environment`, após compilar `@livio/shared`, valida a configuração
Production da API sem abrir conexões. O build da API Vercel executa esse gate para
impedir publicação com scanner ausente. A saída contém somente caminhos/códigos de
validação, nunca os valores. Isso não testa a disponibilidade do scanner hospedado.
