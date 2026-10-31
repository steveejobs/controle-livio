# Testes e evidências

## Inventário e resultados executados nesta auditoria

| Verificação          | Resultado                                                                           | Limite                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| npm run format:check | PASSOU                                                                              | Formatação do checkout local.                                                                 |
| npm run lint         | PASSOU                                                                              | Não substitui análise de segurança.                                                           |
| npm run typecheck    | PASSOU                                                                              | TypeScript estrito para workspaces configurados.                                              |
| npm test             | PASSOU: 155 testes unitários, distribuídos em 43 arquivos (31 API, 8 web, 4 shared) | Testes unitários usam dependências/mocks; não exercitam Supabase real.                        |
| npm run db:validate  | PASSOU                                                                              | Valida schema Prisma; não valida SQL nem conecta ao banco.                                    |
| npm run build        | PASSOU                                                                              | Build local da API/web no snapshot auditado.                                                  |
| npm run perf:bundle  | PASSOU                                                                              | 9 scripts iniciais, 252.961 bytes gzip frente ao limite de 260.000 informado pela ferramenta. |
| npm run test:e2e     | PASSOU: 21/21 cenários Playwright                                                   | Browser local; chamadas de API interceptadas/mocks; não comprova API, DB ou provedores reais. |
| npm audit --omit=dev | ALERTA: 9 findings (7 high, 2 moderate), comando retorna código 1                   | Não prova explorabilidade; não foram instaladas atualizações.                                 |
| git diff --check     | Executado após criação da documentação                                              | Validação de whitespace do diff local.                                                        |

As execuções foram autorizadas pela fase de verificação da missão. Não foram executados comandos que criam registros, alteram banco, aplicam migration, fazem deploy ou usam integração externa sensível.

## E2E e cobertura observada

Os 21 casos cobrem superfícies administrativas e de cliente, navegação/portal, formulário de cliente e OCR sintético, prazos, financeiro, paginação, campos de login/recuperação, simulação de push, assinatura e PWA. Há checks visuais/acessibilidade em dimensões 360 e 1440 px em parte dos cenários.

O número de casos bem-sucedidos não mede cobertura total do produto. 110/110 handlers foram inventariados estaticamente; nenhum dos 110 foi chamado contra API/DB reais nesta auditoria. Os módulos de interface foram mapeados 16/16; testes mockados exercitam apenas fluxos e estados previstos pelos 21 cenários. As três páginas Next e um handler de callback foram localizados; callback real não foi repetido.

## Cobertura de auditoria registrada

| Área                             |                   Encontrado |                                                      Examinado/documentado |                         Verificação operacional real |
| -------------------------------- | ---------------------------: | -------------------------------------------------------------------------: | ---------------------------------------------------: |
| Módulos Nest                     |     13 (12 domínio + Prisma) |                                                                13 mapeados |      Não conectados a serviços reais nesta auditoria |
| Controllers e métodos de rota    | 14 controllers / 110 métodos |                                                       14 / 110 catalogados |                       0/110 chamados contra API real |
| Navegação web                    |                     16 áreas |                                                            16/16 descritas |             21 cenários E2E mockados; todos passaram |
| Páginas/handlers web             |       3 páginas + 1 callback |                                                            4/4 localizados |                        Callback real não reexecutado |
| Models Prisma                    |                           45 | 45 identificados e agrupados; campo a campo permanece no schema executável |    Schema local validado; DB remoto não inspecionado |
| Migrações SQL                    |                           16 |                     16 listadas e consideradas; estado remoto desconhecido |   0 migrations aplicadas/verificadas nesta auditoria |
| Integrações                      |                10 categorias |                                                               10 descritas |             Sem verificação de entrega/estado remoto |
| Testes unitários                 |                          155 |                                                 155 executados e aprovados |                               Mocks e lógica isolada |
| Testes E2E                       |                  21 cenários |                                                  21 executados e aprovados |                      Browser local com APIs mockadas |
| Jornadas de negócio prioritárias |                6 catalogadas |                                                             6 documentadas | 0 comprovadas integralmente com banco/serviços reais |

## Bloqueios e como verificar com segurança

Para API/DB, preparar projeto Supabase descartável ou local isolado com credenciais de teste, executar workflow Supabase de CI e restaurar o ambiente após ensaio. Não reutilizar produção ou homologação com dados reais sem escopo/autorização específica. Testar CRUD e isolamento com tenants artificiais dentro desse projeto.

Para e-mail/push, usar endereço/dispositivo de QA e provedores de teste; registrar resultado sem capturar tokens. Para Storage, criar fixtures sintéticas e confirmar autorização, tamanho, MIME, URLs expiradas, remoção e isolamento. Para assinatura, usar PDF sintético, token de curta duração e conferir estado final/logs com token redigido. Para migrations, fazer dry-run/aplicação apenas em projeto de desenvolvimento confirmado e pela ferramenta protegida, fora desta auditoria.

Falta evidência de desempenho real (load/p95), recuperação de backup, abuso/rate-limit, e2e autenticado com serviço real e validação de entrega externa.
