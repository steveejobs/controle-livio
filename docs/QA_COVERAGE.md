# Cobertura funcional de QA

Atualizado em 2026-10-20. Os testes de navegador usam respostas isoladas da API; a verificação remota
consulta uma organização sintética existente e não altera dados de negócio.

| Área                             | Navegador automatizado                                                                               | API remota de desenvolvimento                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Login, nova senha e recuperação  | Visibilidade da senha, teclado, validação e envio simulado da recuperação                            | Auth usado para obter sessão QA; entrega de e-mail não exercitada |
| Navegação administrativa         | Todas as 16 abas em 360 e 1440 px, carregamento, axe WCAG A/AA, erros de navegador e overflow        | Coleções e permissões de leitura                                  |
| Clientes, processos e documentos | Cadastro e edição de cliente, endereço, contato, observação pública, nota interna, paginação e busca | Listagens autenticadas                                            |
| Tarefas, agenda e notificações   | Prazo, prioridade, status, comentário, lembrete, evento, leitura e reconciliação                     | Listagens autenticadas                                            |
| Financeiro                       | Seleção de parcela do cliente e pagamento com valor decimal exato                                    | Contratos, recebíveis, pagamentos e despesas em leitura           |
| Administração                    | Convite simulado, reconciliação explícita, pipeline e etapas                                         | Usuários, papéis e pipelines em leitura                           |
| Relatórios                       | Seleção dos 12 relatórios e exportação CSV simulada                                                  | Os 12 relatórios e CSV autenticado                                |
| Portal do cliente                | Mensagem, documento privado, navegação restrita, axe e overflow em 360 e 1440 px                     | Leitura como cliente e respostas 403 para recursos vedados        |

Execute `npm run build` e depois `npm run test:e2e` para a suíte de navegador. No Windows com Chrome
instalado, defina `PLAYWRIGHT_CHROME_PATH` para o executável local caso o Chromium do Playwright não
esteja instalado. A verificação remota está documentada em `tools/qa/README.md` e exige a organização
QA identificada explicitamente.

As verificações não demonstram que todas as combinações de dados e permissões estão corretas. Ainda
faltam entrega real de convite/recuperação por SMTP, execução local da suíte RLS/Storage sem Docker,
ensaio isolado de backup/restauração e medições de carga com volume representativo. A web e a API
remotas consultadas são a versão publicada; mudanças locais precisam ser publicadas para validação
remota da nova versão.
