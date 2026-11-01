# Entrega ao primeiro cliente — estado em 2026-11-01

## Pacote preparado

- Código: branch `release/client-handoff-20261101`, PR em rascunho [#2](https://github.com/steveejobs/controle-livio/pull/2). Integra os fluxos de administrador, equipe e cliente com correções de sessão, documentos e recibos.
- A web pública `controle-livio-web.vercel.app` contém somente o hotfix de acesso. A API pública `controle-livio.vercel.app` continua no deployment estável anterior. Ambas respondem ao health check; isso não equivale à publicação da nova release.
- O Quality integrado anterior passou em 6/6 cenários focados e 14/14 completos com Supabase e ClamAV descartáveis. Na execução #41294514959 da PR #2, aplicação e restore passaram, mas o navegador falhou por procurar o feedback de erro EICAR em `status` quando a interface o apresenta como `alert`. O teste foi corrigido; a PR reexecutará os gates sobre o pacote exato de entrega.

## Itens que impedem uso operacional

1. **Scanner de documentos:** a API nova exige `CLAMAV_HOST`, ausente na configuração Vercel Production. O limite `MAX_DOCUMENT_SIZE_MB` foi alinhado para 4 MiB, mas ainda falta scanner privado ou gateway HTTPS autenticado. Não publicar a porta TCP do `clamd` na internet.
2. **Banco publicado:** a última migration aplicada é `20261027150000`. A tabela de comprovantes da migration `20261031120000_payment_receipts.sql` não existe nesse banco. A migration `20261101100000_restrict_public_table_privileges.sql` foi preparada para revogar grants excessivos de `anon` e `authenticated`, observados em 45 tabelas. Nenhuma das duas foi aplicada no banco compartilhado.
3. **Recuperação:** o [Quality #41294514959](https://github.com/steveejobs/controle-livio/actions/runs/41294514959) restaurou o arquivo sintético em banco descartável e passou nas verificações de 46 tabelas, 216 ACLs, 27 default ACLs, owners, estrutura, chaves e totais financeiros. O artefato permanece `INCOMPLETE` porque exclui deliberadamente `cron`/`net`; ainda falta ensaiar o backup histórico com Auth e arquivos do Storage em destino isolado.
4. **Convites e senha:** não há evidência de SMTP custom homologado para endereços de cliente. O fluxo de envio automático e recuperação precisa ser testado com provedor configurado.
5. **Acesso real:** não há colaborador ativo no banco publicado para validar o login desse perfil; o CI cobre os cinco perfis com contas sintéticas. Dependências ainda apresentam três achados altos na cadeia Prisma.

## Ordem de ativação

1. Confirmar ambiente TEST/DEV isolado, scanner privado/gateway autenticado e SMTP do domínio remetente.
2. Aplicar e verificar as migrations no TEST/DEV confirmado, executar login/convite/recuperação, upload limpo/EICAR e restauração de backup em destino separado.
3. Revisar a PR #2 e os resultados completos da CI. Definir backup e janela para as migrations de produção.
4. Após aprovação específica do banco de produção, aplicar as migrations, verificar grants, RLS, dados e health. Publicar API e web da mesma release, testar administrador e colaborador reais e observar logs.

**Classificação atual:** pacote de código em preparação; não entregar para operação com dados reais até completar os itens acima.
