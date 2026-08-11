# ADR 0004: Valores financeiros imutáveis e alocados

- Status: aceito
- Data: 2026-08-07

## Contexto

Sobrescrever saldo ou usar ponto flutuante impede reconciliação e auditoria confiáveis.

## Decisão

Persistir montantes em `decimal(19,4)`, transportar strings decimais e usar Decimal com arredondamento half-even. Principal, pagamento, alocação e ajuste são registros distintos. Reversões geram eventos compensatórios e não apagam históricos.

## Consequências

Saldo é derivado e relatórios precisam de data de corte. Alocações e confirmação exigem transação, bloqueio concorrente e mesma moeda. A interface só arredonda no limite definido pela moeda.
