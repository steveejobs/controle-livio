# Email e recuperação

## Evidência atual

A CI descartável validou convite e recuperação em captura local, incluindo troca de senha, expiração e uso único. A recuperação coordenada aprovou os 58 contratos com SQL/Auth/Storage em destino independente. Resultados estão na [homologação](../HOMOLOGACAO_2026_11_22.md).

Essas provas não certificam entrega SMTP externa, SPF/DKIM/DMARC, configuração hospedada, segredos, backup histórico protegido ou RPO/RTO comercial.

## Email hospedado

Configure SMTP no Supabase Auth e mantenha credenciais no secret manager. Valide domínio/remetente, redirects e limites. Use uma conta de homologação explicitamente autorizada para conferir convite, recuperação, uso único e expiração. Não registrar links bearer, códigos ou senhas nos relatórios.

Não enviar mensagens para clientes ou terceiros como efeito de testes genéricos.

## Recuperação operacional

Database, Auth e objetos Storage precisam de inventário e plano coordenados. Um dump somente de public não inclui automaticamente identities, arquivos, roles globais, configuração hospedada ou segredos.

Restaure em destino novo e isolado. Confirme hash/versão do backup, estrutura, owners/grants/RLS, FKs, sequências, contagens, totais Decimal e bytes/hashes dos arquivos. Verifique login e autorização na API restaurada. Meça duração e perda de dados no escopo operacional escolhido.

Backups protegidos permanecem no armazenamento privado, fora do Git e dos artefatos públicos. Nunca use um backup histórico antigo para reverter o projeto operacional sem procedimento e autorização próprios.
