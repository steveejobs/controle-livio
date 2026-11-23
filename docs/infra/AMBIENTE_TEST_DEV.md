# Ambiente de teste e desenvolvimento

A validação integrada atual roda em Supabase descartável da CI, com dados sintéticos, Auth, PostgreSQL, RLS, Storage, scanner e navegador reais. Veja [a homologação](../HOMOLOGACAO_2026_11_22.md).

## Destinos permitidos

Use stack local Supabase CLI/Docker ou projeto separado explicitamente confirmado como TEST/DEV. O ambiente persistente ligado à Vercel não deve receber runners de escrita, mesmo que tenha sido chamado de desenvolvimento em documentos históricos.

Os templates `api.test.env.template` e `web.test.env.template` contêm somente placeholders. Confirme coerência de URL, project ref, chaves e conexão PostgreSQL antes da execução. Nunca copie credenciais reais para Git, relatórios ou prompts.

## Procedimento

1. Leia [os ambientes](../ENVIRONMENTS.md) e as regras do repositório.
2. Crie ou identifique a stack isolada e configure as variáveis fora do Git.
3. Confirme que guards aceitam exclusivamente os destinos autorizados.
4. Execute os testes aplicáveis e preserve resultados sanitizados em pasta privada.
5. Encerre somente os recursos criados pelo próprio ensaio.

A autorização de CI permite operações de preparação exclusivamente nos bancos sintéticos dos runners. Não autoriza reset, seed, carga ou restauração em banco compartilhado. Migrations exigem confirmação de destino de desenvolvimento.

## Interpretação

Build e testes com mocks não comprovam persistência real. CI descartável não comprova SMTP/scanner/schedulers da hospedagem. A validação da publicação deve usar a candidata implantada e uma organização de homologação autorizada, sem envolver dados ou destinatários reais.
