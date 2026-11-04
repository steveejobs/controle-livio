# Execução de preparação operacional — 2026-11-01

## Linha de base e candidata

Checkout principal: validation/gha-ci-20261029, HEAD inicial 8f5cd3d93b240703292da81d24a9cdd0d065398a. Alterações anteriores preservadas; hashes e status anteriores em BASELINE_EXECUCAO.json. Worktrees: auth-hotfix ba1a9b8; release 8ac9dbc; ci-audit detached 5521a3f. O principal não foi atualizado por checkout/merge. Não houve commit, push, deploy ou escrita cloud.

Base revisável para a próxima candidata: 5521a3f1cebe38e8d89b0ceef38db808c5154fc9, não o ZIP antigo. O complemento listado no MANIFESTO_RELEASE.md inclui limite de fotos e download CSV; não há commits posteriores nesse worktree CI. A adaptação HTTPS desta execução ainda é overlay local e precisa de revisão/CI autorizados antes de integrar uma nova candidata. RELEASE_EXECUCAO.json registra hashes de produto, migrations e OCR da base aprovada. Não declarar SHA comercial novo sem commit.

## Scanner e conta hospedada

Consulta Vercel somente leitura: projeto controle-livio, root apps/api, Node 24.x. Team team_BCETGoN8pn6Z99ueBDt86QFc com billing.plan=hobby, status active. Secure Compute é Enterprise: a conta consultada não é Enterprise. Consulta tentada de endpoint de networks retornou 404, que não é inventário de rede. Não comprovada infraestrutura Dokploy reaproveitável; não existe ferramenta conectada adequada para esse inventário. Não usar conector Supabase de outro projeto (prumo_juridico) para consultar Lívio.

Decisão proposta: VM dedicada 4 GiB + gateway HTTPS autenticado próprio, clamd interno. Referência DigitalOcean 4 GiB/2 vCPU: US$24/mês, fora impostos/domínio/backup/operação. Secure Compute exige Enterprise e cotação, mais scanner; IP estático não cria rede privada. Confirmar plano Vercel comercial adequado antes da ativação: conta retornou Hobby. Não foi contratado recurso.

Cliente HTTPS preparado e gateway em tools/scanner; ver README para configuração exata e homologação. Bearer aleatório sob TLS, sem redirects e sem persistência. Token deve ser rotacionável e guardado no secret manager. Nenhum documento transmitido a terceiros nesta etapa. Autenticação de curta duração/mTLS pode ser requisito adicional do escritório, não foi presumida contratada.

## SMTP preparado

Templates completos em docs/infra/auth-templates/invite.html e recovery.html. Assuntos: “Seu convite para o Lívio Jurídico” e “Recupere seu acesso ao Lívio Jurídico”. Usam SiteURL, TokenHash, type=invite/recovery, next=/reset-password, compatíveis com verifyOtp no callback SSR existente. Não usam fragmento de URL nem concatenam RedirectTo. SiteURL deve ser a origem HTTPS exata do TEST, sem path ou barra final. Allowlist somente callback/origem necessários, sem wildcard de produção.

Proposta Resend SMTP, plano gratuito para homologação (limite publicado de 100/dia; confirmar volume comercial). No Supabase TEST correto: Authentication > Email/SMTP, host smtp.resend.com, porta 465 TLS, usuário resend, senha chave restrita cadastrada diretamente no painel; remetente Lívio Jurídico <acesso@SUBDOMINIO_VERIFICADO>. Confirmar parâmetros no painel do provedor antes de salvar. API SMTP_* não configura o transporte Supabase Auth. Não foi enviado email. Domínio ainda depende de escolha do proprietário; publicar SPF/DKIM exatos fornecidos pelo provedor, sem criar SPF duplicado, e DMARC com monitoração. Desativar tracking de links para preservar tokens de uso único; não incluir dados de clientes no email. Revisar retenção do provedor (tabela pública indica 30 dias nos planos padrão) e DPA.

Homologação: administrador sintético convida destinatário controlado autorizado; abrir em contexto novo, definir senha, comprovar membership/papel; logout/login; recuperação; replay e expiração não criam sessão; refresh após expirar access token mantém organização e permissões; logout invalida acesso local. Captura Mailpit anterior não comprova landing SSR nem entregabilidade. Sessão expirada hospedada continua não resolvida por evidência.

## Banco e recuperação

Continuam exatamente duas migrations após a última registrada 20261027150000: 20261031120000_payment_receipts.sql, depois 20261101100000_restrict_public_table_privileges.sql. Recibos: FKs RESTRICT, tenant triggers, vínculo cliente/financeiro/documento validado, status/hash/JSON checks, unicidade por organização/hash e payment_id, RLS ENABLE/FORCE sem policy de acesso direto, permissões via API. Grants: revoga anon e TRUNCATE/REFERENCES/TRIGGER authenticated; defaults afetam o executor, portanto confirmar role efetiva e outros creators. Não restaurar grants inseguros para rollback.

Preflight/postcheck somente leitura existente permanece válido. Antes da aplicação autorizada: confirmar projeto TEST explicitamente, snapshot atual, ledger/hashes, roles, locks e totais sintéticos; aplicar na ordem via ferramenta versionada; parar em erro, sem editar ledger manualmente. Cada arquivo tem transação própria: falha da segunda não desfaz primeira. Reexecutar postcheck, API anterior e candidata com contas sintéticas; conferir saldo, portal e grants. Compatibilidade da API anterior é exigência de homologação, não comprovada novamente aqui. Não executar agora no compartilhado.

Docker e psql indisponíveis nesta máquina. Não houve novo ensaio descartável; evidência anterior CI 41313409544 cobre migrations e restore sintético, não recuperação operacional completa.

Ensaio isolado preparado: criar projeto/stack TEST e destino de restore separados, com relay email desligado e egress restrito; registrar hora inicial e RPO pretendido; usar somente fixtures sintéticas. Capturar snapshot consistente DB + inventário de objetos por bucket/path/tamanho/SHA256 e copiar bytes para armazenamento privado criptografado. Incluir auth.users/identities e vínculos de profiles/users (não copiar sessões ativas); documentar versão Auth, SMTP/templates/SiteURL/redirects/TTL. Separar secrets via secret manager. Restaurar estrutura/dados/owners/grants/default ACL/RLS/policies/extensões em destino vazio, conforme restore-local-ci.mjs; reconstituir buckets/metadados e bytes, verificar todos hashes. Recriar cron/net/jobs desabilitados inicialmente e secrets/Vault por referências; habilitar apenas após conferir destino. Testar identidade/login/refresh/reset, membership, isolamento entre organizações, download autorizado e negação cruzada, saldos Decimal e execução sintética de scheduler. Registrar contagens antes/depois, RTO real e lacunas. Dump public histórico não satisfaz snapshot atual. Backup SQL não recupera bytes Storage. Nenhuma restauração operacional foi executada nesta etapa.

## Preview e rollback

Após autorização: preparar nova ref comercial com base aprovada e overlay revisto, executar CI afetada; Preview protegido API/web apenas no TEST isolado, Node24 e MAX_DOCUMENT_SIZE_MB=4; verificar assets OCR e modelo por hash, multipart <4,5 MB e PDF dentro de memória/duração. Proteção Preview não pode ser burlada para callback Auth. Só usar mecanismo autenticado aprovado. Não promover aliases. Smoke scanner, SMTP e sessão hospedados antes de aceite.

Rollback preservado: API dpl_6yjRxg682u9ZbL5MWZcgMQZUZivq (gitDirty=1); web dpl_DgnASidnQrWVzEEFsyRGospAhfnb (ba1a9b8). Reconsultar identidade/saúde antes de janela autorizada. Restaurar web antes de API, após comprovar compatibilidade com DB migrado; manter dados de recibos e grants restritos. Sem rollback destrutivo de schema. Falha de segurança exige pausa de escritas e recuperação em destino separado.

## Roteiro executável de aceite no TEST autorizado

Para cada passo registrar hora UTC, deployment/SHA, requestId, ator/organização sintéticos, resultado esperado/observado e evidência sanitizada. Não guardar tokens, links Auth, documentos ou dados reais em artefatos públicos. Falha crítica interrompe aceite; não marcar PASS por ausência de erro visual.

1. Admin A convida colaborador controlado; email chega, callback define senha e /auth/me retorna organização/papel corretos.
2. Esperar expiração access token e recarregar: sessão renova, API responde 200; logout impede acesso; link expirado/reutilizado não autentica.
3. Criar cliente e processo sintéticos; recarregar e conferir IDs/campos persistidos.
4. Contrato R$300 gera recebível R$300; pagamento R$100 deixa R$200; segundo R$200 zera; retry idempotente não duplica.
5. Comprovante sintético limpo passa scanner/OCR, revisão e conciliação; rejeitado não altera saldo; concorrência confirma uma vez.
6. Despesa exige papel/aprovação; perfil sem permissão recebe 403; pagamento aprovado reflete saldo/auditoria.
7. Documento limpo cria versão, assinatura e evidência; EICAR/timeout/indisponibilidade/resposta inválida não criam metadata nem objeto acessível. OCR português lê fixture conhecida.
8. Portal A vê somente cliente A; URLs/IDs de cliente B e organização B negados sem conteúdo. Repetir chamadas diretas, não só UI.
9. Simular erro de rede e expiração: feedback acessível, retry seguro, sem duplicar pagamento/assinatura; conferir desktop e 360px.
10. Restaurar snapshot sintético em destino separado e repetir login, isolamento, download por hash, saldos e scheduler. Aceite exige todas as etapas e evidências, sem skips.

## Fontes verificadas

- https://vercel.com/academy/optimize-your-vercel-account/backend-egress (Enterprise/private networking)
- https://www.digitalocean.com/pricing/droplets (estimativa VM)
- https://resend.com/pricing (limite gratuito e retenção)
- https://supabase.com/docs/guides/auth/auth-email-templates (TokenHash/SiteURL)

## Validacao final desta execucao

- 26/26 testes dirigidos API (scanner TCP/PDF existente + nove contratos HTTPS); 20/20 shared.
- Gateway sintetico local PASS para token invalido, clean, infected e daemon indisponivel. Nao comprova daemon real, TLS, proxy ou armazenamento hospedados.
- Format check versionado PASS (363 arquivos; ferramenta exclui PROJECT_CONTEXT.md modificado). Novos arquivos formatados explicitamente; teste HTTPS reformatado e check final PASS.
- Lint global, TypeScript API/web, Prisma validate e builds API/web PASS. Next build observado 16.4.2, diferente da referencia generica Next16; sem upgrade nesta etapa.
- Suite completa e Playwright nao repetidos: sem alteracao de UI e baseline CI preservado. Novo transporte exige CI integrado real antes de release.
- HEAD final permanece 8f5cd3d93b240703292da81d24a9cdd0d065398a. Comparacao dos hashes anteriores: somente PROJECT_CONTEXT.md, document-scanner.service.ts e packages/shared/src/environment.ts mudaram entre os arquivos preexistentes. Arquivos novos desta rodada: BASELINE_EXECUCAO.json, RELEASE_EXECUCAO.json, EXECUCAO_OPERACIONAL.md, scanner-https.ts/test, tools/scanner/* e auth-templates/*.html.
- CODE_RELEASE_READY PARTIAL (base CI verde, overlay local ainda nao integrado); CLAMAV_HOSTED_READY BLOCKED; SMTP_READY PARTIAL (templates preparados, hospedado bloqueado); DATABASE_MIGRATIONS_READY PARTIAL (CI anterior aprovado, destino atual nao reconsultado/aplicado); BACKUP_RECOVERY_READY BLOCKED; HOSTED_RUNTIME_READY PARTIAL; SECURITY_RELEASE_READY BLOCKED; FIRST_OFFICE_ACCEPTANCE_READY PARTIAL (roteiro pronto, execucao bloqueada); PRODUCTION_GO_NO_GO BLOCKED.
