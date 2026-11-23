# Node portátil para Windows

O projeto usa Node 24.15 ou posterior na linha 24. O CLI de desenvolvimento requer
esse mínimo. O helper fixa Node 24.22.3 LTS, verifica o SHA-256 no índice oficial
Node.js e instala em `%LOCALAPPDATA%/LivioTools/node`. Não substitui o Node global,
não persiste PATH, não sobrescreve instalações existentes e conserva os temporários.

```powershell
& tools/runtime/node24.ps1 -Install
& tools/runtime/node24.ps1 -Arguments @('ci')
& tools/runtime/node24.ps1 -Arguments @('run', 'typecheck')
& tools/runtime/node24.ps1 -Node -Arguments @('tools/qa/verify-receipt-runtime-ci.mjs')
```

Execute a partir da raiz do repositório. O helper não carrega `.env` por conta própria;
as regras de cada comando continuam aplicáveis. Em CI e hospedagem Linux, utilizar
Node 24 atualizado, conforme `engines`; não é necessário instalar este helper.
