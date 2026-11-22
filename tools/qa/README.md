# Ferramentas de QA

Os scripts desta pasta não fazem parte do runtime. Leia a finalidade e os guards antes de executar. Resultados gerados ficam em `test-results/`, `RUNNER_TEMP` ou em uma pasta privada explicitamente escolhida.

## Verificações locais

Após instalar dependências e compilar os pré-requisitos:

```powershell
& tools/runtime/node24.ps1 -Arguments @('run', 'format:check')
& tools/runtime/node24.ps1 -Arguments @('run', 'lint')
& tools/runtime/node24.ps1 -Arguments @('run', 'typecheck')
& tools/runtime/node24.ps1 -Arguments @('test')
& tools/runtime/node24.ps1 -Arguments @('run', 'db:validate')
& tools/runtime/node24.ps1 -Arguments @('run', 'build')
```

Para os testes Node sem banco compartilhado:

```powershell
$files = @(Get-ChildItem tools/qa,tools/storage/recovery,tools/scanner -File -Filter '*.test.mjs' | ForEach-Object { $_.FullName })
& tools/runtime/node24.ps1 -Node -Arguments (@('--test') + $files)
```

Não incluir `tools/supabase/rls.test.mjs` nessa seleção local: ele é uma integração de escrita e exige stack isolada.

## Organização

| Grupo                     | Entradas                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Financeiro                | `run-financial-integrity-ci.mjs`, `financial-integrity-ci.mjs`, `financial-write-matrix.mjs` |
| Identidade e operação     | `identity-integrity-ci.mjs`, `operational-integrity-matrix.mjs`, `identity-corpus.mjs`       |
| Isolamento de cliente     | `client-scope-integrity.mjs`                                                                 |
| Storage e autorização     | `document-storage-matrix.mjs`, `storage-authorization-proof.mjs`, `sdk-storage-proof.mjs`    |
| Navegador real            | `run-integrated-browser-ci.mjs`                                                              |
| Scanner e PDF             | `start-clamav-ci.mjs`, `validate-clamav-ci.mjs`, `verify-payment-receipts-ci.mjs`            |
| Email de captura          | `verify-smtp-capture-ci.mjs`                                                                 |
| Recuperação               | `restore-local-ci.mjs` e `../storage/recovery/`                                              |
| Inventário estático atual | `inventory-functional-surface.mjs --output=<arquivo-novo>`                                   |
| Metadados Prisma          | `generate-prisma-metadata.mjs`, `prisma-model-metadata.mjs`                                  |
| Performance               | `benchmark-*.mjs`, `inspect-prisma-pool.mjs`                                                 |

Os dois geradores que dependiam de inventários congelados de auditorias antigas foram retirados da árvore ativa junto com seus relatórios. O inventário estático atual continua disponível; contagem de declarações não prova execução funcional.

## Contratos da integração

Os runners CI recusam credenciais herdadas, destinos externos, projetos vinculados e ambientes que não sejam descartáveis. Auth, PostgreSQL, Storage e ClamAV são reais na stack sintética. Falhas injetadas são identificadas nos resultados.

Os pais documentais dos controles SQL devem nascer por upload real com PDF válido, scanner, hash e intenção durável. Não criar versões fictícias sem bytes. A restauração aguarda Auth e Storage no destino antes de observar arquivos; erro de provedor nunca prova presença ou ausência.

Conflitos financeiros, isolamento, valores Decimal e auditoria têm asserções independentes. Não transformar erro 500, resposta ambígua ou cenário não executado em PASS.

## Escritas e recursos externos

`verify-workflows.ts`, `cleanup-workflows.ts`, os runners financeiros e os testes Supabase podem escrever dados. `live-readonly.mjs` também opera sessões Auth; não tratá-lo como leitura pura. Benchmarks podem consumir capacidade do pooler.

Não carregar o `.env` compartilhado nesses runners. As confirmações de destino e autorização continuam obrigatórias. Publicação da aplicação não autoriza carga, seed, reset ou restauração no banco persistente.

Resultados e limites da candidata estão em [docs/HOMOLOGACAO_2026_11_22.md](../../docs/HOMOLOGACAO_2026_11_22.md). O roteiro de publicação está em [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md).
