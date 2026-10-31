# Análise de produto

## Solução atualmente observável

O produto é uma aplicação integrada para rotina de escritório jurídico: cadastro e relacionamento com clientes, pipelines e processos, contratos e serviços, documentos, tarefas/prazos, mensagens/portal e acompanhamento financeiro. O código demonstra esse escopo; não demonstra adoção, faturamento, desempenho ou valor percebido por clientes.

## Usuários que o código suporta

- Administrador: gestão da organização, membros, configuração e ações administrativas.
- Advogado: clientes, processos, contratos, documentos, tarefas e leituras financeiras autorizadas.
- Secretaria: suporte a cadastro, processos, documentos e trabalho conforme permissões.
- Financeiro: contratos/serviços, recebíveis, pagamentos, despesas e relatórios, com decisões sensíveis separadas.
- Cliente: portal limitado a vínculo e conteúdo permitido.

Pequeno ou médio escritório é hipótese derivada da modelagem e do fluxo de setup, não pesquisa de mercado.

## Dores que o sistema tenta resolver

Centralização de cadastro e acompanhamento, visibilidade de prazos e tarefas, geração/reuso de documentos, controle de honorários e parcelas, conciliação de pagamentos e comunicação entre escritório e cliente. O valor observável está no elo entre fluxo jurídico e financeiro, com trilha organizacional e permissão por papel.

## Essencial, complementar e potencial diferenciador

| Grupo                | Capacidades                                                                                                                             | Leitura de produto                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Essencial            | Identidade e tenancy, clientes, processos/pipelines, contratos/recebíveis/pagamentos, documentos, agenda/tarefas, permissão e auditoria | Sem estes módulos, a proposta integrada deixa de funcionar.                              |
| Complementar         | Portal do cliente, modelos documentais, relatórios, OCR local, foto, WhatsApp prefill, push                                             | Reduzem atrito, mas dependem de configuração e confirmação operacional.                  |
| Possível diferencial | Fluxo único de cliente a processo, contrato, parcela e documento; linha do tempo; portal; assinatura com evidência                      | São recursos existentes no código; diferencial competitivo/comercial ainda não validado. |

## O que está fora do escopo observado

Não há plano/assinatura de produto, cobrança SaaS, gateway de pagamento, WhatsApp API, automação de e-mail demonstrada, armazenamento offline completo, integração de tribunal/processo eletrônico, operação de escritório sem configuração, ou gestão self-service de múltiplas organizações. Algumas destas podem ser potenciais, não capacidades atuais.

## Autonomia e viabilidade operacional

Cadastro público está desativado. A organização e o primeiro administrador dependem de bootstrap/operador. Recuperação sem SMTP pode depender de administrador e link manual. Push requer VAPID e dispositivo real; armazenamento requer buckets/policies; scheduler requer configuração e credenciais; templates legais requerem revisão do escritório.

O usuário pode completar fluxos simulados na interface, mas a independência operacional em ambiente real não está confirmada. Bloqueios de viabilidade mais concretos: provisioning manual, gestão parcial de membership, ausência demonstrada de SMTP, ciclo incompleto de despesas, ausência de scanner/restore comprovado, risco de upload, dívida de dependências e validação jurídica da assinatura.

## Modelos comerciais possíveis

São hipóteses para pesquisa, não recomendações apoiadas por entrevistas:

- SaaS por organização com faixas por usuários/volume;
- implantação privada/licenciamento para escritórios;
- módulos adicionais para documentos/portal/relatórios.

O código não contém assinatura SaaS ou billing necessário para cobrar qualquer desses modelos. Preços, segmento e demanda não foram investigados.

## Potencial de evolução sustentado pela arquitetura

O modelo multi-tenant, RBAC, audit trail, catálogo de serviços, documentos versionados e jobs Postgres dão base técnica para expansão. Antes, é preciso fechar os ciclos existentes, integrar provisioning, definir restauração, confirmar RLS e publicar contratos API/docs consistentes. Isso é oportunidade técnica, não prova de prontidão comercial.
