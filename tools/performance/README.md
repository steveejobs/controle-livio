# Medição local da web

Inicie o build de produção da web em uma porta local e execute:

```powershell
node tools/performance/measure-web.mjs http://127.0.0.1:3010/
```

O comando aceita somente `localhost` ou `127.0.0.1`. Ele informa o número e o tamanho gzip dos scripts
referenciados no HTML inicial e cinco tempos de carregamento do HTML com servidor aquecido. Os tempos
incluem a máquina local e não representam a experiência do usuário na internet. O tamanho gzip é
calculado localmente sobre cada script; não inclui cookies, dados da API nem transferência real do
navegador. Compare medições no mesmo ambiente e build de produção.

Depois de `npm run build`, execute `npm run perf:bundle` para conferir o orçamento de 260.000 bytes
gzip do JavaScript inicial. O workflow `Quality` executa o mesmo gate. Se uma mudança precisar aumentar
esse valor, meça a causa e registre a decisão antes de ajustar o limite.

Para uma amostra limitada de latência por endpoint local, execute:

```powershell
node tools/performance/measure-http.mjs http://127.0.0.1:3010/ 50 5
```

O comando faz somente GET, aceita até 100 requisições com concorrência máxima de 8 e informa p50/p95
e códigos HTTP. Pode apontar para `/v1/health/ready` da API local. Esse smoke não representa cargas
autenticadas, volume real de dados, Internet ou um teste de capacidade de produção.
