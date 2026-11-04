# Auditoria funcional em andamento — 2026-11-04

## Escopo e estado

Checkout principal `8f5cd3d93b240703292da81d24a9cdd0d065398a`, branch `validation/gha-ci-20261029`, com alterações preexistentes preservadas. A pasta HTTPS indicada não existia no caminho informado; o contexto do projeto registra um backup privado da candidata. Nenhum commit, push, deploy, migration, escrita no Supabase compartilhado ou uso de documentos pessoais em serviços externos.

O mapeamento recursivo gerou `superficie-estatica.json`: 841 declarações (elementos JSX, chamadas e decorators), das quais 130 operações de API e 83 chamadas web formam 213 candidatos rastreáveis em `INVENTARIO_FUNCIONAL_COMPLETO.json`. Há sobreposição e uma declaração pode não representar uma funcionalidade. **O total de funcionalidades reais únicas ainda não foi apurado.** A matriz CSV registra cada candidato como `NOT_EXECUTED` até haver vínculo e evidência operacional individual. Não existe percentual honesto de cobertura integral nesta etapa.

## Execução nesta rodada

| Evidência                                            | Resultado                                                                    | Limite                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| Teste de regressão de RG ilegível, antes da correção | FAIL: `SSP/MA` era devolvido como número de RG                               | Fixture textual sintética                         |
| Mesmo teste após correção                            | PASS; 4/4 testes de parser                                                   | Não mede OCR óptico                               |
| Extração/interpretação de comprovantes               | PASS; 15/15 testes dirigidos, inclusive PNG, JPEG e PDF sintéticos           | Poucos modelos ideais; sem taxa generalizável     |
| Playwright `client-workspace.e2e.ts`                 | PASS, 2/2 cenários em 360 e 1440 px, repetidos após build atualizado         | API simulada                                      |
| Gates                                                | PASS: format, lint, TypeScript, 275 testes, Prisma validate e builds API/web | Unitários e mocks não provam integração hospedada |

O build atualizado passou após a correção e a jornada de navegador foi repetida nele. A suíte mockada completa do mesmo build passou **33/33 cenários em 2,3 min**, cobrindo interações de administração, relatórios, clientes, portal, processos, documentos, financeiro, agenda, PWA e assinatura. Isso não prova banco, RLS ou serviços hospedados. Prisma emitiu apenas o aviso conhecido de depreciação de `metrics`. O checker de formato ignorou `PROJECT_CONTEXT.md` por já estar modificado localmente.

## Avaliação para primeiro escritório

**PRODUCTION_GO_NO_GO: FAIL (NO-GO).** Persistem gates já documentados: ambiente TEST isolado e homologação hospedada do snapshot atual, Auth/templates/SMTP reais, scanner privado HTTPS, migrations de segurança ainda não aprovadas para o banco compartilhado, recuperação completa de banco/Auth/Storage, e aceite das jornadas com identidades reais do escritório. Esta rodada não demonstrou persistência, RLS nem concorrência em infraestrutura descartável. Ver `docs/ativacao-2026-11-01/COBERTURA_FUNCIONAL.md` e `docs/auditoria-2026-10-31/AUDITORIA_PONTA_A_PONTA.md`; resultados de CI anteriores não foram atribuídos ao checkout modificado.

## Próxima execução

1. Ampliar Playwright para 390/768 px, teclado, erros e estados condicionais.
2. Construir banco/Auth/Storage/ClamAV descartáveis, sem usar `.env` compartilhado; executar fluxos por perfil e organização e conferir banco/Storage após refresh.
3. Medir OCR por campo com corpus sintético amplo de RG/CIN/CNH e comprovantes, incluindo erros ópticos, estados agendado/cancelado/devolvido e documentos com múltiplos valores.
4. Executar concorrência financeira, rollback de upload, idempotência e autorização direta por endpoint.
5. Homologar snapshot exato em infraestrutura externa isolada antes de qualquer decisão de publicação.
