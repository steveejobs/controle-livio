# Homologação para release candidate — 2026-10-29

Estado: em execução, sem aprovação comercial. A execução anterior aprovada é
`a7f70d9e7905ac291db4035283afd016d2c32ab0`, Quality
https://github.com/steveejobs/controle-livio/actions/runs/40920818310.
Ela não valida as alterações locais desta etapa.

## Alterações preparadas

- Cliente: teste integrado cria pelo formulário, observa POST real e confere conteúdo enviado,
  resposta, abertura da ficha e persistência após recarga.
- Tarefa: formulário permite atribuir responsável ativo da equipe da organização; diretório protegido
  por `tasks:create`, sem emails ou outros dados pessoais. Consulta ocorre apenas com formulário aberto.
  Teste integrado cria, atribui e conclui pela interface. Estado vazio possui ação verdadeira.
- Erros 500: log central deixa de serializar exceções arbitrárias. Mantém status e correlação;
  teste verifica ausência de token, conta bancária e valor financeiro no log e resposta.
- Multer: override pontual 2.5.0, sem upgrade major de NestJS. Audit de produção passou de cinco
  para três entradas altas, todas na cadeia Prisma/config/deepmerge-ts.

## Jornadas e evidências pendentes

| Jornada                                         | Situação desta etapa                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Cliente                                         | Formulário convertido; execução integrada pendente                                       |
| Processo e advogado                             | Ainda usa criação via API no teste; formulário sem atribuição de advogado                |
| Contrato e recebível                            | Ainda usa criação via API no teste                                                       |
| Pagamento e saldo                               | Formulário coberto no CI anterior; repetir e reforçar saldo exato                        |
| Despesa, aprovação e quitação                   | Formulários cobertos no CI anterior; repetir                                             |
| Documento, download e solicitação de assinatura | Conversão completa para UI pendente                                                      |
| Tarefa, responsável e conclusão                 | Formulário convertido; execução integrada pendente                                       |
| Portal                                          | CI anterior comprova restrições; ampliar registros de outro cliente da mesma organização |

Desktop/mobile, erros e permissões precisam de execução específica para cada jornada antes do aceite.
Não há nova métrica de desempenho. Base anterior: zero P2024, nenhuma requisição pendente, API p95
por módulo entre 21 e 61 ms no runner. Não extrapolar para produção.

## Segurança e serviços

Audit completo também aponta duas entradas críticas na cadeia de ferramentas Vitest/tinypool,
uma moderada e três baixas. Não declarar segurança pronta. Avaliar alcance e atualização compatível
em etapa dedicada; não aplicar `audit fix --force`.
Deepmerge-ts requer objetos cíclicos, que JSON simples não representa; isso limita o vetor, mas não
elimina a vulnerabilidade nem comprova ausência de caminhos exploráveis.

Referências: https://github.com/advisories/GHSA-q7qp-rjg7-q26m e
https://github.com/advisories/GHSA-ggr8-5vv4-36mx.

Uploads continuam bufferizados com limites; controle agregado de memória e antimalware permanecem
pendentes. Não houve alteração de RLS, banco compartilhado ou configuração cloud.

SMTP é necessário para entrega automática de convites e recuperação; a CI atual exclui Mailpit,
portanto não comprova entrega. Push depende de VAPID e adesão do dispositivo. Agendadores são usados
pelos alertas financeiros, tarefas/audiências e resumos de acesso. Realtime e Edge Functions não são
dependências demonstradas destas jornadas; não foram adicionados. Credenciais externas e SMTP
hospedado continuam pendentes de homologação; não usar destinatários reais.

## Recuperação

`tools/qa/restore-local-ci.mjs` aceita somente runner Linux do Actions e endereça um container local
fixo. Gera dump sintético, cria destino aleatório novo, restaura sem sobrescrever banco existente e
compara hashes/contagens das tabelas públicas, constraints, policies, RLS forçada e triggers.
Publica somente resumo em `restore-rehearsal.json`, nunca o dump ou dados Auth.
O banco de destino vive no mesmo PostgreSQL descartável, isolado do projeto compartilhado.
O ensaio ainda não foi executado e pode revelar incompatibilidades de extensão na restauração.
Não substitui restaurar o backup histórico. Exclui donos/grants e extensões de agendamento;
não recupera objetos Storage, configuração Auth hospedada, segredos ou arquivos externos.

## Promoção e primeiro escritório

Gates locais desta etapa: format check, ESLint, TypeScript e Prisma Validate aprovados;
Vitest API 146, web 30 e shared 17 (193/193). Sintaxe do runner de restauração validada por
`node --check`. Build completo interrompido por baixa memória física (aproximadamente 90 MiB livres).
Playwright mockado/integrado e restauração não executados nesta etapa.

Manter deploy desabilitado para `validation/gha-ci-20261029` nos dois `vercel.json`.
Push requer confirmação explícita do responsável. Nenhum novo run desta etapa foi disparado.
Antes do piloto: completar jornadas UI e mobile, resolver riscos de dependências e anexos,
homologar e-mail/agendadores necessários, demonstrar restauração, repetir gates completos e definir
promoção controlada e recuperação operacional.

FUNCTIONAL_READY: PARTIAL

UX_READY: PARTIAL

PERFORMANCE_READY: PARTIAL

SECURITY_READY: NO

BACKUP_RESTORE_READY: NO

COMMERCIAL_PILOT_READY: NO

RELEASE_CANDIDATE_READY: NO
