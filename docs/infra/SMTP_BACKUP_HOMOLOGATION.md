# Próxima homologação: SMTP e recuperação histórica

**Estado em 2026-10-30: preparada, sem envio real e sem restore do backup histórico.** Não foram usados destinatários reais, credenciais externas, projeto compartilhado ou artefato GitHub com backup.

## SMTP de captura

- Usar somente Mailpit/Inbucket local ou caixa de captura autorizada. O workflow atual exclui serviço de e-mail e não comprova entrega.
- Criar convite para usuário sintético `.test`, capturar a mensagem, seguir o link e definir senha; validar usuário, perfil, membership, organização e papel.
- Solicitar recuperação de senha pelo formulário, capturar link, concluir troca e validar login. Exercitar validade expirada, uso único e link reutilizado; os links não devem aparecer nos logs.
- Manter SMTP externo, domínio remetente e contas de clientes fora do teste. Configuração hospedada só depois de credenciais em secret manager e autorização específica do ambiente de homologação.

**Dependência:** Docker/Supabase local com caixa de captura ou um serviço TEST isolado autorizado. Docker não está disponível nesta estação; os fluxos SMTP não foram simulados como homologados.

## Backup histórico

- O inventário local registra arquivo PostgreSQL custom do schema `public`, 735.578 bytes. O SHA-256 calculado nesta estação corresponde ao checksum registrado no inventário `BACKUP_PRE_MIGRATION_DESPESAS.md`.
- Esse dump não inclui Auth, Storage, roles globais, configurações do Supabase/Vercel, Vault ou arquivos externos. O checksum prova identidade do arquivo, não uma restauração ponta a ponta.
- A restauração histórica deve usar destino novo, sem vínculo Supabase/Vercel, sem rotas públicas e sem credenciais de Production/Preview. O arquivo não deve sair do armazenamento local protegido nem ser anexado ao GitHub.
- Antes do restore, verificar hash e versão do `pg_restore`; listar TOC sem extrair dados ao log; mapear owners/grants a roles sintéticas; criar banco novo sem sobrescrever outro; restaurar e conferir tabelas, sequências, constraints/FKs, grants, RLS, contagens e agregados financeiros em SQL Decimal.
- Recuperação completa exige plano separado para Auth (configuração, identities e vínculo seguro a `profiles`/`users`), Storage (buckets, policies e objetos com inventário/hash) e arquivos armazenados fora do Postgres. Recriar chaves e secrets pelo secret manager, sem copiar valores para o dump ou artefatos.
- Registrar RPO/RTO medidos, resultado de acesso por papel e integridade de downloads. Só testar restauração do histórico quando houver destino novo e isolado e ferramentas locais; não reutilizar o projeto compartilhado.

O job `synthetic-restore` testa dados artificiais criados na stack efêmera e não lê este arquivo histórico. A aprovação desse job não substitui o restore histórico.
