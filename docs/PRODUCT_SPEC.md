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

### Cadastro e preparação do cliente

O cadastro identifica pessoa física por CPF e pessoa jurídica por CNPJ, aplica a máscara enquanto
o documento é digitado e muda para pessoa jurídica ao ultrapassar 11 dígitos. Ao salvar um novo
cliente, um assistente abre automaticamente o financeiro. Salvar a cobrança avança para honorários;
salvar o contrato avança para documentos. Cada etapa também permite continuar sem preenchê-la e
voltar à anterior, sem procurar abas. Depois de gerar ou anexar os três documentos, o assistente
oferece a ficha completa. O saldo financeiro por moeda, contratos e arquivos permanecem reunidos na
ficha. A cobrança pode ser vinculada ao contrato para preencher valores e vencimentos do modelo.

### Documentos do cliente

Contrato de honorários, procuração e declaração de hipossuficiência são gerados em DOCX na própria
etapa do cadastro, com dados atuais do cliente. O contrato usa os honorários e as parcelas da cobrança
vinculada; para pessoa jurídica, a qualificação usa nome e CPF do representante legal cadastrados.
Qualificação civil adicional de pessoa física é armazenada em `clients.custom_fields.legalIdentity`.
Dados profissionais do escritório são configurados uma vez por um administrador em `organizations.settings.legalDocuments`.

Os modelos mantêm o logotipo e as fontes dos documentos de referência. Cada emissão é um rascunho
interno e a emissão seguinte cria uma nova versão imutável; alterações posteriores no cadastro não
reescrevem silenciosamente arquivos já emitidos.

### Comercial

Novo contato → Qualificação → Proposta → Contratado ou Perdido. Converter um contato em cliente/processo não apaga o histórico comercial.

### Jurídico

Triagem → Em preparação → Em andamento → Aguardando decisão → Encerrado. Etapas são configuráveis; mover um processo grava origem, destino, autor, instante, motivo opcional e metadados.

### Cobrança

A vencer → Em atraso → Em negociação → Recebido ou Inadimplente. O pipeline auxilia a operação, mas o saldo é sempre derivado dos lançamentos financeiros, nunca da etapa visual.

Uma cobrança também pode registrar um objetivo sem valor financeiro, como aguardar documentos ou concluir uma diligência. Ao marcar essa opção, a tela abre a descrição do objetivo; esse acompanhamento fica no CRM e não cria recebível, parcela ou saldo.

### Serviços contratados

O contrato permite marcar todos os serviços abrangidos, organizados entre jurídico criminal e demais serviços jurídicos. A lista já inclui atividades criminais comuns, como acompanhamento em delegacia, audiência de custódia e habeas corpus. A equipe pode salvar novos serviços no catálogo da própria organização para reutilização. O primeiro serviço marcado é a classificação principal usada nos relatórios existentes.

O contrato também pode incluir uma ou mais audiências. Essa opção fica desmarcada para serviços que não envolvem audiência, como acompanhamento em delegacia. Ao ativá-la, a pessoa informa data, horário e local opcional, escolhe avisos de 1 hora, 30 minutos e 10 minutos e pode incluir outros intervalos. O evento entra como agendado na Agenda e os avisos pendentes são recalculados se o horário mudar ou removidos se for cancelado. O responsável pelo cadastro recebe a notificação interna e, se tiver push habilitado, o aviso no dispositivo.

## Princípios para formulários

- Cada campo nomeia a informação real do módulo: por exemplo, “Nome da oportunidade” no comercial e “Número judicial” no jurídico. Não repetir “assunto”, “título” ou “descrição” se esses dados não tiverem finalidades distintas.
- Mostrar apenas campos que se aplicam ao tipo selecionado. O modelo de honorários, por exemplo, determina se a tela pede valor fixo, valor por hora e/ou percentual de êxito.
- Campos opcionais de classificação e relatório ficam fora do percurso principal e não recebem conteúdo genérico automático.
- Resumos e listas traduzem valores internos para termos de trabalho usados pela equipe.
- O fluxo principal avança com a ação que conclui cada etapa; não exige que a pessoa encontre a próxima aba.

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

## Modelos e atividades

O Administrador pode editar contrato de honorários, procuração e declaração de hipossuficiência no
próprio módulo de documentos. A lista de dados automáticos apresenta nomes e explicações; selecionar
um item insere o dado no local do cursor. A prévia mostra exemplos de preenchimento. O sistema valida
marcadores incompletos/desconhecidos e conserva as informações essenciais de cada modelo; restaurar
retorna ao texto padrão. O texto personalizado só afeta novas emissões. Alterações não salvas ficam
visíveis e a tela confirma antes de descartá-las ao trocar ou restaurar o modelo.

Administradores com `audit:view` têm a página **Atividades do sistema**, que combina mudanças,
acessos, módulos abertos e fichas consultadas. Filtros por categoria, usuário, período e busca ajudam
a localizar eventos sem apresentar valores financeiros ou dados pessoais antigos.
