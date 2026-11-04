# Financeiro

As rotas de recebíveis, pagamentos, despesas e comprovantes estão no catálogo. O código usa `Prisma.Decimal` na interpretação e confirmação de recibos; testes dirigidos de interpretação/extração passaram. A confirmação exige papel `receipts:approve`, `payments:create` ou `expenses:update`, compara valor/data extraídos e exige motivo quando divergem; data futura é bloqueada. Isso é inspeção do código e teste unitário, não prova de transação real nesta rodada.

| Fluxo × erro                                               | Resultado desta rodada     | Evidência faltante                                                           |
| ---------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| Pagamento duplicado/concorrente                            | NOT_EXECUTED               | Duas sessões contra PostgreSQL descartável, conferência de saldo e histórico |
| PIX agendado/cancelado/devolvido                           | PARTIAL                    | Parser não classifica situação; confirmação integrada pendente               |
| Valor com separador brasileiro                             | PASS para parser sintético | OCR em variedade de comprovantes                                             |
| Upload aprovado, registro falha                            | NOT_EXECUTED               | Simular falha após Storage e conferir objeto órfão                           |
| Estorno, cancelamento, desconto, multa, juros, conciliação | NOT_EXECUTED nesta rodada  | Conferência de ledger e relatórios no banco                                  |

O CI anterior (`docs/ativacao-2026-11-01/CI_41313409544.json`) contém cenários integrados em snapshot diferente; não foi somado à cobertura desta rodada.
