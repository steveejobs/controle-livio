# Desempenho e eficiência

Atualizado em 2026-10-20.

## O que foi medido

O build de produção da web foi servido localmente na mesma máquina antes e depois da divisão do
quadro de processos. `tools/performance/measure-web.mjs` baixou o HTML inicial, somou o tamanho gzip
dos scripts referenciados nele e mediu cinco cargas do HTML com o servidor aquecido.

| Medida                  |         Antes |             Depois |
| ----------------------- | ------------: | -----------------: |
| Scripts iniciais        |            10 |                  9 |
| JavaScript inicial gzip | 251.592 bytes |      249.065 bytes |
| Redução                 |             — | 2.527 bytes (1,0%) |

Os tempos locais de HTML aquecido ficaram entre 4–10 ms nas amostras observadas. Esses números não
incluem rede pública, hidratação, chamadas autenticadas nem aparelhos lentos. O gate `npm run
perf:bundle` impede que o JavaScript inicial ultrapasse 260.000 bytes gzip no CI.

Um smoke HTTP local, somente com GET, mediu:

| Endpoint               | Requisições / simultâneas |      p50 |      p95 | Resultado        |
| ---------------------- | ------------------------: | -------: | -------: | ---------------- |
| Web `/`                |                    50 / 5 |    34 ms |    77 ms | 50 respostas 200 |
| API `/v1/health/live`  |                    10 / 1 |     2 ms |    15 ms | 10 respostas 200 |
| API `/v1/health/ready` |                    10 / 1 |   921 ms |   930 ms | 10 respostas 200 |
| API `/v1/health/ready` |                    30 / 5 | 4.601 ms | 4.796 ms | 30 respostas 200 |

O readiness consulta o Supabase remoto. A URL local de runtime usa o Transaction pooler com
`connection_limit=1`, conforme a configuração segura para serverless; consultas simultâneas da mesma
instância ficam enfileiradas. Os tempos incluem a distância entre esta máquina e o banco. Eles
identificam esse gargalo do ambiente local, mas não estimam a latência da Function publicada perto do
banco. Alterar o limite de conexões de produção exige medir o número de instâncias e a capacidade do
pooler. O smoke só consulta a raiz web e health; não simula usuários autenticados nem relatórios.

## Trabalho evitado

- O quadro de processos agora é carregado somente quando uma das abas de processos/CRM é aberta. A
  lista de clientes usada no cadastro de processo só é consultada quando o formulário aparece.
- A reconciliação de notificações saiu do login. A primeira abertura da central a executa; reaberturas
  dentro de cinco minutos usam o resultado recente, e “Atualizar alertas” força nova execução. O
  navegador confirmou 0 reconciliações no login, 1 na primeira abertura, 0 adicionais na reabertura
  imediata e 1 na atualização manual.
- O cliente HTTP compartilha leituras simultâneas da mesma URL por sessão/organização, cancela o
  transporte quando todos os leitores saem e impede que uma leitura iniciada antes de uma escrita
  reponha dados antigos no cache. O cache fica limitado a 80 entradas.
- A rotina diária processa destinatários em lotes de até oito, evitando um pico de consultas sem limite
  no pool de conexões. Alertas financeiros inalterados deixam de gerar `UPSERT` repetido; a consulta
  de alertas anteriores transfere somente notificações financeiras.
- A consulta financeira agrega pagamentos/ajustes apenas das parcelas elegíveis a alerta. No projeto
  de desenvolvimento, uma comparação somente leitura confirmou linhas idênticas para a organização QA
  (5 alertas) e para um cliente isolado (2 alertas). `EXPLAIN ANALYZE` mostrou 0,983 → 0,315 ms no
  primeiro caso e 0,217 → 0,203 ms no segundo. O conjunto QA é pequeno; esses tempos não demonstram
  ganho em uma organização grande.

## Regressão no navegador

`npm run test:e2e` inicia o build web localmente na porta 3010 e executa Chromium com respostas
isoladas da API. O teste em 360 px verifica o primeiro acesso, a abertura do formulário de processo,
o carregamento tardio de clientes, a reconciliação de alertas na primeira abertura, a reabertura sem
nova reconciliação, a atualização manual, ausência de overflow e o retorno do foco ao fechar o menu
com Escape. A suíte também roda no workflow `Quality`, após o build e a instalação do Chromium.

Localmente, execute `npm run build` antes de `npm run test:e2e`. Se o navegador Chromium do Playwright
não estiver instalado, execute `npx playwright install chromium`. É possível apontar
`PLAYWRIGHT_CHROME_PATH` para um Chrome local. As respostas da API são simuladas e não tocam o
Supabase; o teste protege a interação e a quantidade de requisições, não valida dados reais.

## Próxima medição necessária

Para estabelecer metas reais de p95 e capacidade, coletar tempos por rota da API e métricas de
carregamento em aparelhos e conexões usados pelos clientes. Repetir os planos SQL e um teste de carga
com dados sintéticos em volume representativo no ambiente de homologação. Só então escolher índices,
novas políticas de cache ou paginação adicional com base no gargalo observado.
