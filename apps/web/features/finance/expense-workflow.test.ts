import { describe, expect, it } from 'vitest';
import {
  canSubmitExpense,
  expenseSubmitButtonLabel,
  expenseSubmitSuccessMessage,
} from './expense-workflow';

describe('estado de aprovação de despesas na interface', () => {
  it('bloqueia envio quando aprovação é obrigatória e não há outro aprovador', () => {
    const policy = { required: true, canSubmitForApproval: false };
    expect(canSubmitExpense(policy)).toBe(false);
    expect(expenseSubmitButtonLabel(policy)).toBe('Enviar para aprovação');
  });

  it('permite envio para aprovação quando há aprovador independente', () => {
    const policy = { required: true, canSubmitForApproval: true };
    expect(canSubmitExpense(policy)).toBe(true);
    expect(expenseSubmitSuccessMessage(policy)).toBe('Despesa enviada para aprovação.');
  });

  it('mostra confirmação e libera pagamento quando aprovação está desabilitada', () => {
    const policy = { required: false, canSubmitForApproval: true };
    expect(canSubmitExpense(policy)).toBe(true);
    expect(expenseSubmitButtonLabel(policy)).toBe('Confirmar despesa');
    expect(expenseSubmitSuccessMessage(policy)).toBe(
      'Despesa confirmada e liberada para pagamento.',
    );
  });

  it('não habilita o envio antes de carregar a política da organização', () => {
    expect(canSubmitExpense(undefined)).toBe(false);
  });
});
