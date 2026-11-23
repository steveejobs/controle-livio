# Prova local do adaptador PostgreSQL

O runner cria um cluster PostgreSQL 17 novo no diretório temporário, com senha sintética,
SCRAM e listen exclusivo em `127.0.0.1`. Confere data directory, porta, versão e cluster,
exige schema vazio e aplica somente DDL CREATE do modelo Prisma. Não utiliza URLs de
banco recebidas, não carrega `.env`, não executa migrations Supabase nem limpeza destrutiva.
Encerra somente o servidor criado e preserva seus arquivos. Evidência sanitizada em `test-results/`.

Instalação das ferramentas fora do repositório, com versão fixa e integridade npm:

```powershell
$pgTools = Join-Path $env:LOCALAPPDATA 'LivioTools/postgres17'
& tools/runtime/node24.ps1 -Arguments @('install', '--prefix', $pgTools, 'embedded-postgres@17.12.0-beta.19', '--ignore-scripts', '--no-audit', '--no-fund')
& tools/runtime/node24.ps1 -Node -Arguments @('tools/database/verify-prisma-adapter.mjs', '--new-local-development')
```

Requer `npm run build:packages` e cliente gerado. As provas cobrem dinheiro Decimal,
datas, JSON, registros relacionados, P2002, rollback, conflito serializável P2034 e limite/fila
do pool real. O banco usa o modelo ORM; não substitui homologação das policies, triggers,
Supabase Auth/Storage, scanner ou recuperação completa. Nenhum resultado deve ser transportado
para produção. A CLI de diff recebe explicitamente a URL do cluster criado; a configuração
Prisma pode ler o `.env` normal, cujos valores são sobrepostos pela URL local nesse processo.

A prova monetária inclui um valor de 19 dígitos: `900719925474099.1234`. O preview
`relationJoins` foi desativado após reproduzir arredondamento na leitura JSON de uma relação;
as leituras padrão por consultas separadas devem conservar os quatro decimais. Os serviços
financeiro e de ficha de cliente são chamados contra PostgreSQL real para testar pagamento
parcial, repetição, quitação, estorno, auditoria e saldo. Isso não representa teste HTTP/Auth/RLS.

A prova de desconexão encerra somente o backend da transação sintética no cluster próprio,
confere rollback e exige leitura imediata saudável. O adaptador descarta a conexão no rollback
por lease associado ao pool; transações confirmadas continuam reutilizando conexões. Nenhuma
escrita ambígua é repetida automaticamente. Falhas de serialização conhecidas mantêm o retry
limitado existente, usando SQLSTATE real do adaptador.
