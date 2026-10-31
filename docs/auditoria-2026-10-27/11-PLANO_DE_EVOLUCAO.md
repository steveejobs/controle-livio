# Plano de evolução recomendado

Este documento ordena investigação e trabalho futuro. Nenhuma ação abaixo foi executada como correção.

## P0 — Confirmar a superfície e reduzir risco de dados

| Classificação | Ação sugerida                                                                                                                                                     | Dependências / evidência de conclusão                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| INVESTIGAR    | Identificar formalmente ambiente/branch que deve ser fonte de verdade e comparar com checkout local alterado.                                                     | HEAD, release e configuração de deploy; não confiar em histórico isolado.                |
| CORRIGIR      | Remover token bearer de logs e respostas de erro para rotas públicas de assinatura; preferir segredo fora do path ou redigir URL antes de qualquer logger/filtro. | Teste automatizado com token sintético deve provar que logs e resposta não o reproduzem. |
| CORRIGIR      | Alinhar limite do interceptor de upload com limite de negócio e estratégia de memória/streaming.                                                                  | Teste com arquivos no limite, sobre o limite e carga concorrente em ambiente isolado.    |
| INVESTIGAR    | Validar RLS, policies de Storage, grants e migrações no projeto de desenvolvimento confirmado, em modo somente leitura antes de qualquer operação.                | Ref do projeto confirmada por operador; comparar 16 migrações e schema Prisma.           |
| CORRIGIR      | Triar 9 vulnerabilidades transitivas e escolher atualizações compatíveis, sem upgrade major automático.                                                           | SBOM/alcance de pacote, changelog/compatibilidade, testes e build depois.                |

## P1 — Tornar uso diário completo

| Classificação | Ação sugerida                                                                                                                                    | Dependências / evidência de conclusão                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| COMPLETAR     | Criar seleção explícita de organização e descoberta de memberships, ou restringir o produto a uma membership por usuário com regra documentada.  | API segura e UX; teste de duas organizações em Supabase isolado. |
| COMPLETAR     | Definir ciclo de despesas: rascunho, aprovação, pagamento, rejeição/cancelamento e auditoria, ou remover campos sem uso após decisão de produto. | Regras financeiras e matriz de permissão.                        |
| COMPLETAR     | Definir ciclo de papéis/membership, incluindo edição, revogação e auditoria, ou reduzir UI às operações suportadas.                              | Revisão de identidade e política administrativa.                 |
| INVESTIGAR    | Resolver expectativa de recorrência do calendário: expandir ocorrências ou apresentar a regra como informativa/planejamento.                     | Semântica de fuso/feriados/edição em série.                      |
| COMPLETAR     | Recuperação de assinatura com estado PROCESSING preso e idempotência/retry explícitos.                                                           | Simular falhas entre Storage/DB e garantir original consistente. |
| COMPLETAR     | Preparar SMTP de domínio e confirmar convite/reset com mailbox de QA.                                                                            | Provedor, DNS e política de Auth.                                |

## P2 — Operação confiável e experiência

| Classificação | Ação sugerida                                                                                                | Dependências / evidência de conclusão                               |
| ------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| COMPLETAR     | Scanner antimalware e política de retenção/quarentena para uploads.                                          | Definir tipos/fluxo de segurança sem bloquear documentos legítimos. |
| INVESTIGAR    | Fazer ensaio documentado de backup e restauração de Database e Storage.                                      | Ambiente descartável; RPO/RTO definidos.                            |
| COMPLETAR     | Provar push em dispositivo real e revisar expiração/remoção de subscriptions.                                | VAPID, browser e sistema operacional de QA.                         |
| REESTRUTURAR  | Definir navegação por URL para áreas que precisam de deep link e histórico previsível.                       | Decisão de UX; manter permissões server-side.                       |
| APROVEITAR    | Reusar linha do tempo, modelos, catálogo de serviços, portal e alertas nas jornadas principais.              | Pesquisa com usuários internos e fluxo de suporte.                  |
| CORRIGIR      | Atualizar docs/API/modelo/migrações para refletir routes atuais e automatizar geração de referência OpenAPI. | Comparação da spec com 110 handlers.                                |

## P3 — Decisões de produto e consolidação

| Classificação | Ação sugerida                                                                                                              | Dependências / evidência de conclusão                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| INVESTIGAR    | Medir utilização do dashboard legado e possíveis endpoints sem consumidores; confirmar clientes externos antes de remover. | Telemetria e busca no deploy/integrações.                                  |
| REESTRUTURAR  | Consolidar nomes/navegação entre Processos, CRM jurídico e Pipelines se usuários tiverem dificuldade de descoberta.        | Teste de usabilidade; não inferir apenas por duplicidade de código.        |
| REMOVER       | Avaliar protótipo de dashboard estático somente depois de provar que nenhum deploy/usuário depende dele.                   | Confirmar referência e histórico; esta auditoria não remove nada.          |
| CRIAR         | Considerar provisioning self-service e billing somente após validar modelo comercial.                                      | Pesquisa de mercado, segurança multi-tenant e ciclo financeiro do produto. |
| POTENCIAL     | Integrações externas de pagamento/tribunais/WhatsApp podem ser avaliadas depois de validar necessidade e custos.           | Requisitos, conformidade, suporte do provedor e limites legais.            |

## Critério de encerramento de cada etapa

Uma próxima fase só deve ser marcada concluída com evidências: testes isolados para mudanças, migration diff e revisão no projeto correto quando houver schema, fluxo de autenticação sem tokens em logs, matriz de permissões coberta por papéis e objetos, comportamento acessível em viewport estreita, documentação atualizada e rollback/backup exercitado quando há persistência.
