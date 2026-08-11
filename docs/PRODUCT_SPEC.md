# Especificação do produto

## Objetivo

O Lívio concentra a jornada de um escritório jurídico em um sistema multiempresa: aquisição e cadastro do cliente, condução do processo, documentos, compromissos, trabalho interno e recebimento. O backend desta entrega implementa os fluxos reais e mantém dados de demonstração somente no seed de desenvolvimento.

## Usuários e acesso

- **Administrador:** configura organização, usuários, papéis, permissões e pipelines.
- **Advogado:** conduz clientes e processos, produz documentos, notas, tarefas e compromissos.
- **Secretaria:** mantém cadastro, agenda, documentos e andamento operacional.
- **Financeiro:** administra contratos, recebíveis, pagamentos, ajustes e despesas sujeitos a aprovação.
- **Cliente:** consulta exclusivamente informações publicadas e pertencentes ao seu vínculo.

Permissões são combinações de recurso e ação: `view`, `create`, `update`, `delete`, `export`, `approve` e `manage`. Os papéis iniciais são modelos, não exceções embutidas nos endpoints. Uma organização pode criar papéis adicionais.

## Fluxos

### Comercial

Novo contato → Qualificação → Proposta → Contratado ou Perdido. Converter um contato em cliente/processo não apaga o histórico comercial.

### Jurídico

Triagem → Em preparação → Em andamento → Aguardando decisão → Encerrado. Etapas são configuráveis; mover um processo grava origem, destino, autor, instante, motivo opcional e metadados.

### Cobrança

A vencer → Em atraso → Em negociação → Recebido ou Inadimplente. O pipeline auxilia a operação, mas o saldo é sempre derivado dos lançamentos financeiros, nunca da etapa visual.

## Regras funcionais essenciais

1. Toda consulta ou mutação de negócio ocorre no contexto de uma organização autenticada.
2. Exclusões operacionais usam arquivamento/soft delete quando existe obrigação de retenção. Auditoria, versões e movimentos financeiros não são apagados pela aplicação.
3. O estado atual do processo aponta para uma etapa; o histórico de etapas é anexado na mesma transação.
4. Um documento lógico tem versões imutáveis. Nova edição cria outra versão e atualiza o ponteiro somente após armazenamento, hash e metadados válidos.
5. Tarefas têm responsável, prioridade, vencimento e estados explícitos. Conclusão registra instante; reabertura deve gerar atividade.
6. Recebíveis, pagamentos, alocações, ajustes e despesas têm moeda explícita. Não são aceitas operações entre moedas sem conversão registrada.
7. Aprovação financeira é distinta de criação quando a política da organização exigir segregação de funções.

## Critérios permanentes

Cada módulo inclui DTO validado, autorização, escopo da organização, transação quando necessário, auditoria e testes negativos. Uploads usam armazenamento privado, URL assinada curta e validação básica por assinatura; varredura antimalware assíncrona deve ser adicionada antes de aceitar documentos não confiáveis em produção. A interface deve continuar responsiva, acessível, modular e baseada no tema/motion central.
