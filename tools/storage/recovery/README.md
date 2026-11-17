# Recuperação persistente — candidata local Etapa 6.1

Implementação ativa **na candidata local**, não publicada nem implantada. Não importa a proposta inativa `../def007-proposal`. Production NO-GO. Nenhuma instrução deste diretório autoriza execução hospedada, varredura destrutiva ou ativação de scheduler.

## Contrato implementado

- Prisma e migration versionada registram organização, operação, chave imutável, finalidade, hash, idempotência, lease, geração, oito tentativas e histórico. Uma chave que iniciou limpeza nunca pode ser vinculada novamente.
- Os cinco uploads passam por intenção durável antes do efeito externo e confirmação transacional do vínculo. Comprovante e documento compartilham a mesma transação. A assinatura usa duas intenções e um grupo PROCESSING com lease.
- O reconciliador faz claim com capacidade privada rotativa e lease persistente, sob SKIP LOCKED. Observação, remoção e conferência HTTP ocorrem **fora** das transações. Transações curtas revalidam dono/lease, referências, retenção e catálogo; DELETING/cleanupStartedAt são confirmados antes do efeito externo. Essa chave fica permanentemente indisponível para novos vínculos. Falha SQL após remoção deixa DELETING recuperável por outro processo. Retenção nova não pode atravessar um fence DELETING já confirmado.
- Timeout de um upload nunca observado registra `abandonedAt`, impede anexação/reenvio e conserva UPLOADING apenas até o lease original vencer. O pedido original ainda pode terminar nesse intervalo; não se permite criar um novo vínculo após abandono. A rechecagem posterior remove somente o objeto comprovado da intenção, ou abre incidente. Ausência ainda incerta não recebe conclusão falsa.
- Referências de versões históricas, soft delete, fotos e assinaturas revogadas são consultadas, incluindo outras organizações. Vínculo, retenção ou hash divergente impedem exclusão. Objetos desconhecidos nunca entram automaticamente na fila de remoção.
- ABSENT continua agendado para rechecagem diária. Não significa inventário universal sem órfãos nem acesso ao backend interno não indexado do provedor.
- Oito falhas abrem incidente persistente e notificação IN_APP ao Administrador canônico ativo; ausência de destinatário fica registrada. Nova falha após retry manual reabre o incidente, mantendo as decisões anteriores na auditoria.
- `/storage-recovery` oferece consulta paginada, inventário somente leitura por prefixo da organização, inspeção de referências e decisões RETAIN/RETRY. Exige Administrador e permissões específicas. Não existe endpoint de exclusão direta, liberação de retenção ou restauração fictícia.
- A UI em Administração permite revisão com motivo, rechecagem, conflito concorrente e paginação. Incidentes de integridade conservados permanecem abertos; conservar não restaura arquivos.

`STORAGE_RECOVERY_DISPATCH_ENABLED=false` e `STORAGE_RECOVERY_DELETE_ENABLED=false` são os padrões. A compensação imediata usa somente ticket privado da própria operação. O dispatch HMAC usa finalidade `storage-recovery-dispatch` e job-state `storage_recovery`, sem broker novo ou scheduler instalado.

## Implantação futura, sujeita a autorização própria

1. Revisar conjuntamente schema, escritores e reconciliador. Rodar `preflight.sql` somente no destino explicitamente autorizado e confirmar owner, memberships, ausência de estruturas conflitantes e baseline.
2. Aplicar expansão e conferir `postcheck.sql`; nunca modificar migrations anteriores. A expansão aceita referências legadas desconhecidas e protege desde já as chaves gerenciadas. Ela não corrige uploads de escritores antigos.
3. Implantar os cinco escritores coordenadamente, mantendo worker desabilitado. Pausar admissões afetadas se houver implantação parcial; não remover fila/histórico para recuar.
4. Executar Quality e provas reais completas em infraestrutura descartável. Revisar evidências e todos os contratos ainda bloqueados.
5. Só com autorização posterior avaliar admissão estrita `require_managed_references`, frequência, monitoramento e ativação do worker. Não habilitar flags por ter compilado.

## Verificações locais seguras

```text
node --test tools/storage/recovery/support.test.mjs
node --test tools/storage/recovery/qualification.test.mjs
node tools/qa/restore-local-ci.mjs --check-toc-filter
node tools/storage/recovery/sql-probe.mjs <caminho-absoluto-do-modulo-PGlite>
```

O probe PGlite utiliza exclusivamente PostgreSQL 17 em memória e esquema mínimo sintético. Não instala dependências, não aceita URL e não representa PostgreSQL/Supabase/Storage reais, concorrência ou crash. Os testes Vitest do serviço usam falhas em memória e estão identificados como tais.

## Prova Linux preparada

O workflow separado `storage-recovery.yml` não foi publicado ou disparado. Os quatro jobs do Quality existente continuam obrigatórios. O workflow preparado limita PRs draft à branch de validação do próprio repositório; a entrada manual exige `disposable-new-stack`. Ele utiliza stack nova do runner, ClamAV/qpdf reais e credenciais geradas localmente. Não usar segredos de conta cloud. O ambiente recusa Windows, `.env`, project-ref vinculado, SMTP externo, endpoints externos e caminhos de evidência fora de RUNNER_TEMP.

`run-ci.mjs` reutiliza o ciclo de vida da API própria, executa a regressão financeira preservada e inicia os primeiros 57 contratos. Depois de encerrar a API e as conexões, executa REC-X18 e agrega os 58 resultados. Falha anterior não é apagada pelo restore. O harness chama os escritores compilados, não mocks de persistência. Fault injection fica restrita às instâncias do harness. O crash envia barreira após upload real, mata exclusivamente o filho criado e recupera em outro processo/conexão. Não exporta tickets, JWTs, cookies ou URLs assinadas.

F07 usa `delayed-provider.mjs`: proxy HTTP de loopback retém o **pedido original**, incluindo multipart, antes de encaminhá-lo uma única vez ao Storage real. O cliente recebe timeout primeiro. SQL deve conservar a intenção abandonada, GET deve comprovar ausência nesse instante; ao liberar a barreira, o mesmo pedido deve produzir HTTP de sucesso e objeto com hash correto. A recuperação em processo novo só começa depois dessa prova física. Cinco propósitos passam pelos cinco escritores reais. A prova local do proxy utiliza outro servidor HTTP sintético e **não vale como F07 integrado**.

REC-X01 mede espera/duração das transações e consulta `pg_stat_activity` por application_name exclusivo do worker durante latência controlada seguida de GET real. Não aceita transação aberta nessa janela. Os demais controles preservam crash, commit falho após remoção, retenção, duas decisões e concorrência de anexação.

### Restore coordenado e limites

`coordinated-restore.mjs` cria fixtures pelos serviços reais: documento/versões, foto, assinatura completa, crash de assinatura, intenção pendente, compensação, hold, ausência e incidente após oito falhas. Inclui comprovante efetivo do harness financeiro. A origem fica quiescente; não são admitidos cron jobs ativos ou transações concorrentes.

`stack-identity.mjs` exige labels Docker, project_id, volume Storage e system_identifier PostgreSQL correspondente ao endpoint de loopback. O destino recebe project_id aleatório novo, cluster e volume diferentes. Somente depois dessa identificação executa reset **explicitamente local** nesse destino descartável. Não usa configuração vinculada ou credencial hospedada.

Backup compreende dados public/auth/storage/supabase_migrations e cópia física do volume Storage, com hash de cada arquivo. O helper usa a imagem Storage já disponível, `--pull=never --network none`, origem somente leitura e destino vazio; recusa symlinks e sobrescrita. Dump, objetos e credenciais de fixture ficam em diretório privado de RUNNER_TEMP e não entram nos artefatos públicos.

O destino reaplica migrations versionadas e compara owners/grants/RLS/policies/funções/triggers/papéis antes e depois do restore. A restauração de dados usa sessão isolada com replication_role=replica para replay do histórico imutável, seguida de varredura real de todas as FKs; convalidated não substitui essa conferência. Verifica linhas, sequências, bytes, hashes, Auth e API. Um novo processo retoma pendências e assinatura PROCESSING, preservando vínculos, versões, hold e comprovante. A limpeza final utiliza somente o project_id registrado desse job.

**Nenhum dos 58 contratos reais executou nesta máquina Windows.** As seis receitas faltantes agora possuem implementação, mas os cinco F07 e REC-X18 conservam NOT_EXECUTED até execução Linux. Não existe PASS integrado por teste unitário, cópia local de bytes ou parser SQL. O runner completo exige 58 PASS e mantém falhas explícitas. O restore operacional geral continua INCOMPLETE: cron/net, configuração hospedada, SMTP externo, RPO/RTO e operação comercial não são certificados pelo REC-X18.

O restore existente foi ampliado com inventário nominal de 31 owners e dez ACLs novos; rejeita substituições mesmo com contagem idêntica e mantém as comparações integrais de dados/grants/owners. Isso prepara compatibilidade de esquema, sem comprovar restore operacional. Não liberar publicação/ativação como se a matriz de 58 estivesse completa.

O relatório e a matriz individual da Etapa 6.0 ficam em `docs/auditoria-2026-11-04/`. Não declarar DEF-007 operacionalmente resolvido, zero arquivos órfãos ou produto pronto para operação comercial.
