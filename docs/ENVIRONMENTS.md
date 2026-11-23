# Ambientes

| Ambiente    | Dados                                        | Operação                                    |
| ----------- | -------------------------------------------- | ------------------------------------------- |
| Local/test  | Stack Supabase CLI com dados fictícios       | Desenvolvimento e testes isolados           |
| Development | Projeto explicitamente identificado como DEV | Alterações após confirmação do destino      |
| Staging     | Projeto de homologação isolado               | Validação operacional sem dados reais       |
| Production  | Projeto persistente com dados reais          | Publicação autorizada e operação monitorada |

`NODE_ENV=production` seleciona o runtime otimizado. `SUPABASE_ENVIRONMENT` classifica o destino de dados; são conceitos distintos. `SUPABASE_LOCAL=true` só é permitido com endpoints locais e ambiente não produtivo.

## Configuração

Database URL, Supabase URL, project ref e confirmação precisam apontar para o mesmo projeto. A API valida o ambiente na inicialização. Staging/production exigem configuração de scanner; não usar um endereço fictício ou bypass para fazer o serviço iniciar.

- Use `.env.example` como referência de nomes, nunca como fonte de credenciais reais.
- Configure os segredos hospedados no secret manager do provedor.
- A web recebe somente URL da API, URL Supabase e chave pública permitida.
- Service role, senha PostgreSQL, token do scanner, VAPID privado e segredo de cron pertencem ao servidor.
- Segredos protegidos da Vercel podem não ser exportáveis pelo CLI; a ausência no arquivo exportado não prova ausência no runtime.

## Operações de banco

Migrations operacionais vêm de `supabase/migrations`; Prisma não cria um segundo histórico. Resets, seeds e testes de escrita não devem alcançar banco compartilhado. Confirme um destino de desenvolvimento antes de aplicar migrations. Não executar operações destrutivas sob autorização genérica de deploy.

A CI tem autorização específica para bancos sintéticos criados pelos próprios runners, com guards de loopback, projeto, cluster e volume. Isso não se estende à hospedagem persistente.

## Email, arquivos e recuperação

Auth local usa captura de email. SMTP externo, domínio e entregabilidade exigem configuração e teste próprios. Scanner indisponível bloqueia arquivo; não deve permitir promoção silenciosa ao Storage.

Backup Database e backup dos objetos Storage são independentes. Restaure primeiro em destino novo e isolado, valide Auth, permissões, FKs, dados, arquivos e hashes, e só então avalie promoção. Dumps e segredos não entram em artefatos públicos.
