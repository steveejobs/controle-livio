export type ExpenseApprovalPolicyView = {
  required: boolean;
  canSubmitForApproval: boolean;
};

export function canSubmitExpense(policy?: ExpenseApprovalPolicyView): boolean {
  return Boolean(policy && (!policy.required || policy.canSubmitForApproval));
}

export function expenseSubmitButtonLabel(policy?: ExpenseApprovalPolicyView): string {
  if (!policy) return 'Carregando política';
  return policy.required ? 'Enviar para aprovação' : 'Confirmar despesa';
}

export function expenseSubmitSuccessMessage(policy?: ExpenseApprovalPolicyView): string {
  return policy?.required
    ? 'Despesa enviada para aprovação.'
    : 'Despesa confirmada e liberada para pagamento.';
}
