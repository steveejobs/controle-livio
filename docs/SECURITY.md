# Segurança

## Autenticação

Supabase Auth é o único autenticador. Next.js usa `@supabase/ssr` para refresh e cookies seguros; a API
recebe access token por `Authorization: Bearer` e valida com a chave anon/pública. Login, convite,
logout e recuperação não passam por tabelas de senha próprias. Redirects são limitados por ambiente.

As tabelas legadas `sessions` e `password_reset_tokens` permanecem inativas apenas para preservar o
histórico de schema. `users.password_hash` é nullable e a migration definitiva limpa hashes depois de
confirmar que toda conta ativa possui `auth_user_id`.

O mínimo de senha do projeto de desenvolvimento/homologação foi reduzido de 12 para 6 caracteres em
2026-10-20 por solicitação do responsável. Isso facilita senhas fracas; recomenda-se senha única e
longa e reavaliar o mínimo antes de abrir acesso público. O formulário e o Auth remoto usam o mesmo
limite; a confirmação da senha é validada no cliente.

## Autorização

O tenant vem de `organization_members`, nunca do body/query. A proteção combina:

1. RLS baseada em `auth.uid()`, membership e permissões;
2. guardas NestJS com negação por padrão e `RequirePermission`;
3. filtros explícitos por `organizationId` nos serviços;
4. triggers que impedem FKs cruzadas entre organizações.

Papéis de sistema: administrador, advogado, secretaria, financeiro e cliente. O código usa permissões
centralizadas `recurso:ação`; não depende de `if role === admin` espalhado.

O papel PostgreSQL `authenticated` recebe somente `SELECT`, `INSERT`, `UPDATE` e `DELETE` nas tabelas
públicas. Isso permite que a requisição alcance o RLS, que continua negando por tenant, cliente e
permissão; o papel não recebe `TRUNCATE`, `REFERENCES`, `TRIGGER` nem privilégios administrativos.

O catálogo de serviços é consultado e gravado somente pela API, sempre filtrado pela organização do
ator. Criar um serviço exige `contracts:create`, grava auditoria e não concede policy direta no banco
ao navegador.

## Restrições administrativas e alertas

Algumas operações exigem o papel oficial `administrator`, além da permissão granular: exportar
relatórios, estornar pagamentos, decidir correções financeiras e configurar alertas de acesso. Um papel
personalizado com as mesmas permissões não substitui essa verificação. Advogado, secretaria e financeiro
podem consultar relatórios, mas não exportá-los.

Cada login por senha ou confirmação de convite registra um evento `SYSTEM_ACCESS` idempotente pela
sessão. O histórico é protegido contra alteração/remoção no banco. O Administrador configura até cinco
horários no fuso da organização para receber resumos internos de acesso. Correções de pagamento feitas
por outros perfis criam solicitações pendentes e notificam Administradores; somente a aprovação gera
estorno e novo pagamento, na mesma transação e com auditoria.

## Service role

Fotos de clientes ficam no bucket privado `client-photos`, sem policies de acesso direto para o navegador. A API exige organização e `clients:view` para emitir URL assinada por cinco minutos; upload e remoção exigem `clients:update`, verificam assinatura JPG/PNG/WebP, limitam o arquivo a 5 MB e registram auditoria. O link temporário pode permanecer válido até expirar depois de a foto ser trocada ou removida. Mensagens de cobrança pelo WhatsApp são montadas no navegador a partir do saldo consultado; abrir a conversa não equivale a envio confirmado.

`SUPABASE_SERVICE_ROLE_KEY` é obrigatória somente no servidor para Storage administrativo, convites e
bootstrap. Nunca aparece em variável `NEXT_PUBLIC_`, resposta, HTML, bundle ou log. A API não usa essa
chave para autorizar regras financeiras nem para aceitar tenant enviado pelo cliente.

## Documentos

Bucket privado, signed URLs curtas e metadata sem URL pública. Upload pela API valida tamanho, MIME,
assinatura mágica, nome sanitizado, organização e vínculos. Extensão/Content-Type do navegador não são
suficientes. Varredura antimalware assíncrona continua um requisito explícito antes de produção; o
sistema não declara arquivos como seguros sem scanner.

Geração de modelo exige `documents:create` e leitura explícita dos dados usados (`clients:view`; para
contratos, também `contracts:view` e `receivables:view`). Os arquivos gerados ficam como rascunhos
internos em versões imutáveis. Identidade profissional é configurável somente por Administrador e
fica isolada em `organizations.settings`; auditoria registra a alteração sem copiar dados bancários.

## Operação

Produção exige TLS, CORS explícito, custom SMTP, rotação de chaves, rate limit distribuído, logs/alertas,
backup restaurável do Database e política separada para Storage. Seeds, resets e testes RLS são
bloqueados em produção. Bootstrap e migration remotos exigem confirmações independentes.

## Browser push

Push uses VAPID and a separate opt-in for each user/device. The API accepts HTTPS endpoints only from supported push providers, stores endpoint keys in the database, and removes expired subscriptions. System messages contain generic titles and bodies; client, payment, and matter details stay inside Lívio behind authentication. The browser asks for explicit permission. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` only in the API project; without all three, the UI reports that server setup is pending.

## Leitura de documento de identificação

OCR roda no navegador usando worker e pacote de idioma português hospedados junto com o sistema. A imagem não é enviada a um serviço de leitura externo. Depois de o cadastro ser confirmado, a imagem é enviada à API do sistema e fica no histórico privado do cliente. Nome, CPF, RG, órgão expedidor e data de nascimento são sugestões editáveis. A pessoa responsável precisa revisar os dados; a extração não confirma a autenticidade do documento.

## Templates e trilha de atividades

Modelos editáveis e dados profissionais são limitados ao papel oficial Administrador, com a permissão
de organização correspondente. As variáveis são aceitas por lista permitida e validadas por categoria;
auditoria guarda somente categoria e estado personalizado, nunca o corpo do modelo.

A tela de atividades também exige Administrador e `audit:view`. Consultas são limitadas à organização
ativa e mostram ator, ação, horário e nomes dos campos alterados sem devolver valores anteriores ou
posteriores. A abertura de módulo confere a permissão daquele módulo; a abertura de ficha confere
permissão e vínculo/tenant antes de registrar.

# Revisão de homologação de 2026-10-21/22

- `clients` e `client_contacts` usam RLS por `current_client_id` para membros do portal; `notifications` exige o `user_id` da própria membership. `client_messages` só aceita criação para cliente permitido e autor autenticado; a atualização direta de notificações também exige destinatário próprio. O teste real detectou e comprovou a correção das leituras cruzadas; a escrita direta está em verificação adicional.
- A API não grava mais o ID de sessão Supabase no FK da tabela legada `sessions`; preserva esse ID nos metadados da auditoria. A inclusão de cliente voltou a funcionar no ensaio com Supabase real.
- O cron de minuto usa Vault, HMAC SHA-256 com timestamp curto e claim atômico de replay. A fila `pg_net` não contém o segredo, pois os grants gerenciados pelo Supabase podem permitir leitura da fila a outros papéis da plataforma.
- Convites e redefinições de senha por link gerados pelo Supabase Auth são mostrados uma vez ao Administrador e não são copiados para o log de auditoria. Apenas Administrador com `users:manage` pode gerar o link de recuperação de membro ativo da própria organização; o evento é auditado sem o token. Sem provedor SMTP, o envio automático por e-mail continua pendente.
