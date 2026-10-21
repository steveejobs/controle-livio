# Arquitetura Supabase

## Plataforma única

Supabase Database, Auth, Storage e RLS são a plataforma persistente oficial. Prisma acessa o mesmo
Database como ORM; NestJS mantém transações financeiras, documentos, relatórios e administração.
`supabase/migrations` é o único histórico executável.

## Identidade e multiempresa

Supabase Auth é a única fonte de identidade e senha. `profiles` possui um registro global por
`auth.users.id`. `organization_members` vincula o profile a uma organização e a um `users` operacional,
preservado para compatibilidade com FKs de ator/responsável. Um profile pode ter várias memberships.
`organization_member_roles` é a fonte de papéis da membership; permissões continuam normalizadas em
`roles`, `permissions` e `role_permissions`.

A API valida os claims do Bearer token pelo Supabase Auth, busca uma membership ativa e deriva o tenant. Um
`X-Organization-Id` arbitrário nunca concede acesso: apenas seleciona uma membership já existente.
O Auth legado, Argon2, cookie próprio e CSRF foram retirados do runtime. A migration final bloqueia se
existir usuário ativo sem `auth_user_id` e somente então limpa hashes próprios.

## RLS

Todas as 36 tabelas originais e as novas `profiles`, `organization_members` e
`organization_member_roles` têm RLS. As helpers `current_organization_ids`, `has_permission`,
`current_client_id` e `can_access_client_resource` derivam acesso de `auth.uid()` e memberships.

Tabelas append-only não recebem UPDATE/DELETE. Registros ligados a cliente — processos, contratos,
recebíveis, pagamentos, mensagens, agenda e documentos — restringem o portal ao `client_id` da
membership. `internal_notes` nunca é concedida ao papel cliente. Triggers de tenant continuam como
segunda barreira para a conexão privilegiada da API.

## Storage

O bucket `legal-documents` é privado. Novos objetos usam
`organizations/{organizationId}/documents/{documentId}/...`. A policy de upload valida membership e
`documents:create`; a policy de leitura também exige metadata em `document_versions`, documento não
excluído, permissão e, para portal, `visibility=CLIENT` e client correto. Path não é autorização.

A API usa service role apenas para upload compensado, remoção e signed URL depois de validar o recurso
no Database. Administração de usuários usa service role apenas no servidor para convite/provisionamento.
A chave nunca possui prefixo `NEXT_PUBLIC_`.

## Migrations e transição

As três migrations de 2026-08-07 foram preservadas. A migration aditiva
`20260809120000_auth_memberships_hardening.sql` consolida o modelo, e
`20260812150000_authenticated_table_grants.sql` concede DML ao papel `authenticated` para que as
policies RLS possam ser avaliadas. As cinco migrations foram aplicadas ao projeto novo de
desenvolvimento/homologação em 2026-10-20. As Prisma migrations estão arquivadas e não podem ser
executadas em paralelo.

Antes de aplicar em um ambiente com usuários legados, cada conta ativa deve ser criada/convidada no
Supabase Auth e receber `users.auth_user_id`. Hash Argon2 não é convertido. Usuários sem credencial
compatível devem usar convite/recuperação do Supabase.

## Local e testes

A migration aditiva `20261021150000_access_alerts_and_payment_change_requests.sql` está preparada,
mas ainda não foi aplicada: falta confirmar o banco de desenvolvimento. Ela ativa RLS forçada na tabela
de solicitações financeiras sem políticas de acesso direto pelo navegador; a API autentica e autoriza
essas operações. Também torna os eventos `SYSTEM_ACCESS` imutáveis.

A migration `20261021170000_service_catalog.sql` adiciona o catálogo reutilizável de serviços por
organização. Ela aplica RLS forçada sem policy de acesso direto pelo navegador; a API escopa consultas
e gravações pela organização autenticada. Também está preparada e aguarda confirmação do banco de
desenvolvimento antes de ser aplicada.

`supabase/config.toml` habilita Database, Auth, Storage, Studio, Inbucket e seed. `supabase db reset`
reproduz o banco do zero. `tools/supabase/rls.test.mjs` autentica seis usuários fictícios e testa acesso
direto por PostgREST/Storage entre organizações A/B e roles.

## Backup

Database: snapshot/PITR conforme plano, retenção definida e restauração ensaiada em projeto isolado.
Storage: retenção/versionamento/exportação próprios; backup do Database não restaura conteúdo binário.
Depois da restauração, validar RLS, Auth/profile/membership, constraints, objetos e hashes antes de uso.
