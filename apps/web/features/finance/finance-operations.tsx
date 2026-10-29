'use client';

import { Fragment, useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { addMonths, decimalToCents, formatDate, formatMoney, splitAmount } from '../shared/format';
import { LoadMore } from '../shared/load-more';
import { useApiData } from '../shared/use-api-data';
import { useNearViewport } from '../shared/use-near-viewport';
import { usePaginatedData } from '../shared/use-paginated-data';
import {
  canSubmitExpense,
  expenseSubmitButtonLabel,
  expenseSubmitSuccessMessage,
  type ExpenseApprovalPolicyView,
} from './expense-workflow';

type Client = { id: string; displayName: string };
type Installment = {
  id: string;
  sequence: number;
  amount: string;
  dueDate: string;
  status: string;
  allocations: Array<{ amount: string }>;
  adjustments?: Array<{ kind: string; amount: string }>;
};
type Receivable = {
  id: string;
  clientId: string;
  reference: string;
  description: string;
  originalAmount: string;
  currency: string;
  status: string;
  dueDate: string;
  client: Client;
  installments: Installment[];
};
type ContractOption = { id: string; clientId: string; number: string; title: string };
type Payment = {
  id: string;
  reference: string;
  amount: string;
  currency: string;
  status: string;
  paidAt: string;
  method: string;
  externalId?: string | null;
  client: Client;
  allocations: Array<{
    installmentId: string;
    amount: string;
    installment?: { sequence: number; receivable: { reference: string } };
  }>;
};
type PaymentProposal = {
  reference: string;
  amount: string;
  paidAt: string;
  method: string;
  externalId?: string | null;
  allocations: Array<{ installmentId: string; amount: string }>;
};
type PaymentChangeRequest = {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  reviewNote?: string | null;
  requestedByName: string;
  proposedData: PaymentProposal;
  payment: {
    reference: string;
    amount: string;
    currency: string;
    paidAt: string;
    method: string;
    externalId?: string | null;
    client: Client;
  };
};
type Expense = {
  id: string;
  clientId?: string | null;
  matterId?: string | null;
  responsibleUserId?: string | null;
  description: string;
  category: string;
  amount: string;
  currency: string;
  status: string;
  incurredAt: string;
  dueDate?: string | null;
  paidAt?: string | null;
  rejectionReason?: string | null;
  reimbursable: boolean;
  client?: Client;
  matter?: { id: string; reference: string } | null;
  responsibleUser?: { id: string; fullName: string } | null;
  documents?: Array<{ id: string; title: string; visibility?: string }>;
};
type ExpenseHistoryEvent = {
  id: string;
  action: string;
  transition?: string;
  occurredAt: string;
  actorName: string;
  changedFields: string[];
};
type MatterOption = { id: string; reference: string; client: Client };
type UserOption = { id: string; fullName: string };
type ExpenseSummary = {
  currencies: Array<{
    currency: string;
    pendingApproval: { count: number; amount: string };
    pendingPayment: { count: number; amount: string };
    overdue: { count: number; amount: string };
    paid: { count: number; amount: string };
  }>;
};

type PaymentAttempt = { payload: string; idempotencyKey: string };

function decimalUnits(value: string): bigint {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,4})?$/.test(normalized)) throw new Error('Valor financeiro inválido.');
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole!) * 10_000n + BigInt(fraction.padEnd(4, '0'));
}

function unitsToDecimal(value: bigint): string {
  const whole = value / 10_000n;
  const fraction = String(value % 10_000n)
    .padStart(4, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function installmentBalance(installment: Installment): string {
  const adjusted = (installment.adjustments ?? []).reduce(
    (total, adjustment) =>
      adjustment.kind === 'DISCOUNT'
        ? total - decimalUnits(adjustment.amount)
        : total + decimalUnits(adjustment.amount),
    decimalUnits(installment.amount),
  );
  const paid = installment.allocations.reduce(
    (total, allocation) => total + decimalUnits(allocation.amount),
    0n,
  );
  return unitsToDecimal(adjusted > paid ? adjusted - paid : 0n);
}

function receivableBalance(receivable: Receivable): string {
  return unitsToDecimal(
    receivable.installments.reduce(
      (total, installment) => total + decimalUnits(installmentBalance(installment)),
      0n,
    ),
  );
}

type FinanceRead =
  | 'receivables'
  | 'paymentReceivables'
  | 'payments'
  | 'paymentChangeRequests'
  | 'expenses'
  | 'expenseSummary'
  | 'expensePolicy';

const expenseStatusLabels: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_APPROVAL: 'Aguardando aprovação',
  APPROVED: 'Aguardando pagamento',
  REJECTED: 'Rejeitada',
  PAID: 'Paga',
  CANCELLED: 'Cancelada',
};

const expenseHistoryActionLabels: Record<string, string> = {
  CREATE: 'Despesa cadastrada',
  UPDATE: 'Despesa alterada',
  APPROVE: 'Despesa aprovada',
  CANCEL: 'Despesa cancelada',
};

const expenseHistoryTransitionLabels: Record<string, string> = {
  SUBMIT: 'Enviada para aprovação',
  CONFIRM: 'Confirmada sem aprovação',
  APPROVE: 'Aprovação registrada',
  REJECT: 'Rejeição registrada',
  PAY: 'Pagamento integral registrado',
  CANCEL: 'Cancelamento registrado',
};

const today = () => new Date().toISOString().slice(0, 10);

function OperationFeedback({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className={message.startsWith('Erro:') ? 'notice notice-error' : 'notice notice-success'}
    >
      {message}
    </div>
  );
}

function ExpenseHistoryPanel({ expenseId }: { expenseId: string }) {
  const history = usePaginatedData<ExpenseHistoryEvent>(
    `/finance/expenses/${expenseId}/history`,
    10,
  );

  if (history.error && !history.data)
    return (
      <div role="alert" className="notice notice-error">
        {history.error.message}
      </div>
    );
  if (!history.data)
    return (
      <p role="status">{history.loading ? 'Carregando histórico…' : 'Histórico indisponível.'}</p>
    );

  return (
    <div className="expense-history-panel" aria-label="Histórico da despesa">
      {history.data.items.length === 0 ? (
        <p>Nenhuma alteração registrada.</p>
      ) : (
        <ol className="expense-history-list">
          {history.data.items.map((event) => (
            <li key={event.id}>
              <strong>
                {expenseHistoryTransitionLabels[event.transition ?? ''] ??
                  expenseHistoryActionLabels[event.action] ??
                  event.action}
              </strong>
              <span>
                {event.actorName} · {formatDate(event.occurredAt)}
              </span>
              {event.changedFields.length > 0 && (
                <small>Campos: {event.changedFields.join(' · ')}</small>
              )}
            </li>
          ))}
        </ol>
      )}
      <LoadMore
        shown={history.data.items.length}
        total={history.data.total}
        loading={history.loading}
        error={history.error}
        onLoad={history.loadMore}
        onRetry={history.retry}
      />
    </div>
  );
}

export function FinanceOperations({
  permissions,
  isAdministrator,
}: {
  permissions: readonly string[];
  isAdministrator: boolean;
}) {
  const canCreateReceivable = permissions.includes('receivables:create');
  const canViewReceivables = permissions.includes('receivables:view');
  const canCreatePayment = permissions.includes('payments:create');
  const canViewPayments = permissions.includes('payments:view');
  const canApprovePayments = isAdministrator && permissions.includes('payments:approve');
  const canRequestPaymentChange = permissions.includes('payments:update');
  const canApproveReceivables = permissions.includes('receivables:approve');
  const canCreateExpense = permissions.includes('expenses:create');
  const canViewExpenses = permissions.includes('expenses:view');
  const canUpdateExpenses = permissions.includes('expenses:update');
  const canApproveExpenses = permissions.includes('expenses:approve');
  const canCreateDocuments = permissions.includes('documents:create');
  const canViewDocuments = permissions.includes('documents:view');
  const canManageExpensePolicy = isAdministrator && permissions.includes('organization:update');
  const [mode, setMode] = useState<'receivable' | 'payment' | 'expense'>(
    canCreateReceivable ? 'receivable' : canCreatePayment ? 'payment' : 'expense',
  );
  const [editingExpense, setEditingExpense] = useState<Expense>();
  const receivablesViewport = useNearViewport<HTMLElement>();
  const paymentsViewport = useNearViewport<HTMLElement>();
  const paymentChangeRequestsViewport = useNearViewport<HTMLElement>();
  const expensesViewport = useNearViewport<HTMLElement>();
  const clientsNeededForForm =
    (mode === 'receivable' && canCreateReceivable) ||
    (mode === 'payment' && canCreatePayment) ||
    (mode === 'expense' && canCreateExpense) ||
    Boolean(editingExpense);
  const clients = usePaginatedData<Client>(
    permissions.includes('clients:view') && clientsNeededForForm ? '/clients' : undefined,
    100,
  );
  const [selectedClient, setSelectedClient] = useState('');
  const [receivableClientId, setReceivableClientId] = useState('');
  const [receivableContractId, setReceivableContractId] = useState('');
  const [expenseClientId, setExpenseClientId] = useState('');
  const [expenseStatusFilter, setExpenseStatusFilter] = useState('');
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('');
  const [expensePeriodFilter, setExpensePeriodFilter] = useState('dueDate');
  const [expenseFrom, setExpenseFrom] = useState('');
  const [expenseTo, setExpenseTo] = useState('');
  const [expenseApprovalDraft, setExpenseApprovalDraft] = useState<boolean>();
  const expenseParams = new URLSearchParams();
  if (expenseStatusFilter) expenseParams.set('status', expenseStatusFilter);
  if (expenseCategoryFilter) expenseParams.set('category', expenseCategoryFilter);
  if (expensePeriodFilter) expenseParams.set('period', expensePeriodFilter);
  if (expenseFrom) expenseParams.set('from', expenseFrom);
  if (expenseTo) expenseParams.set('to', expenseTo);
  const expensePath =
    canViewExpenses && expensesViewport.visible
      ? `/finance/expenses${expenseParams.size ? `?${expenseParams}` : ''}`
      : undefined;
  const receivables = usePaginatedData<Receivable>(
    canViewReceivables && receivablesViewport.visible ? '/finance/receivables' : undefined,
  );
  const payments = usePaginatedData<Payment>(
    canViewPayments && paymentsViewport.visible ? '/finance/payments' : undefined,
  );
  const paymentChangeRequests = usePaginatedData<PaymentChangeRequest>(
    canRequestPaymentChange && paymentChangeRequestsViewport.visible
      ? '/finance/payments/change-requests'
      : undefined,
  );
  const expenses = usePaginatedData<Expense>(expensePath);
  const expensePolicy = useApiData<ExpenseApprovalPolicyView>(
    canViewExpenses && (expensesViewport.visible || (mode === 'expense' && canCreateExpense))
      ? '/finance/expenses/approval-policy'
      : undefined,
  );
  const expenseSummary = useApiData<ExpenseSummary>(
    canViewExpenses && expensesViewport.visible
      ? `/finance/expenses/summary${expenseFrom || expenseTo ? `?${new URLSearchParams({ ...(expenseFrom ? { from: expenseFrom } : {}), ...(expenseTo ? { to: expenseTo } : {}) })}` : ''}`
      : undefined,
  );
  const expenseResponsibles = useApiData<UserOption[]>(
    canViewExpenses && (mode === 'expense' || Boolean(editingExpense))
      ? '/finance/expenses/responsibles'
      : undefined,
  );
  const expenseMatters = usePaginatedData<MatterOption>(
    canViewExpenses &&
      permissions.includes('matters:view') &&
      (mode === 'expense' || Boolean(editingExpense))
      ? '/matters'
      : undefined,
    100,
  );
  const paymentReceivables = usePaginatedData<Receivable>(
    mode === 'payment' && selectedClient
      ? `/finance/receivables?clientId=${encodeURIComponent(selectedClient)}`
      : undefined,
  );
  const receivableContracts = usePaginatedData<ContractOption>(
    mode === 'receivable' && canCreateReceivable ? '/finance/contracts' : undefined,
    100,
  );
  const [adjusting, setAdjusting] = useState<string>();
  const [reversing, setReversing] = useState<string>();
  const [editingPayment, setEditingPayment] = useState<Payment>();
  const [payingExpense, setPayingExpense] = useState<string>();
  const [rejectingExpense, setRejectingExpense] = useState<string>();
  const [expenseHistoryId, setExpenseHistoryId] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [busy, setBusy] = useState(false);
  const paymentAttempt = useRef<PaymentAttempt | undefined>(undefined);

  const openInstallments = useMemo(
    () =>
      (paymentReceivables.data?.items ?? [])
        .filter((item) => !selectedClient || item.clientId === selectedClient)
        .flatMap((item) =>
          item.installments
            .filter(
              (installment) => !['PAID', 'CANCELLED', 'RENEGOTIATED'].includes(installment.status),
            )
            .map((installment) => ({
              ...installment,
              remainingAmount: installmentBalance(installment),
              clientId: item.clientId,
              reference: item.reference,
              clientName: item.client.displayName,
            })),
        ),
    [paymentReceivables.data, selectedClient],
  );

  const finish = async (
    action: () => Promise<unknown>,
    success: string,
    refresh: readonly FinanceRead[] = [],
  ) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      setFeedback(success);
      if (refresh.includes('receivables')) receivables.reload();
      if (refresh.includes('paymentReceivables')) paymentReceivables.reload();
      if (refresh.includes('payments')) payments.reload();
      if (refresh.includes('paymentChangeRequests')) paymentChangeRequests.reload();
      if (refresh.includes('expenses')) expenses.reload();
      if (refresh.includes('expenseSummary')) expenseSummary.reload();
      if (refresh.includes('expensePolicy')) expensePolicy.reload();
      return true;
    } catch (caught) {
      setFeedback(
        `Erro: ${caught instanceof ApiError || caught instanceof Error ? caught.message : 'operação não concluída'}`,
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createReceivable = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const issueDate = String(form.get('issueDate'));
    const firstDueDate = String(form.get('firstDueDate'));
    try {
      const amounts = splitAmount(
        String(form.get('total')),
        String(form.get('entry')),
        Number(form.get('installmentCount')),
      );
      const entry = String(form.get('entry'));
      const hasEntry = entry.trim() !== '' && decimalToCents(entry) > 0n;
      const installments = amounts.map((amount, index) => ({
        sequence: index + 1,
        amount,
        dueDate:
          hasEntry && index === 0 ? issueDate : addMonths(firstDueDate, index - (hasEntry ? 1 : 0)),
      }));
      void finish(
        () =>
          api('/finance/receivables', {
            method: 'POST',
            body: JSON.stringify({
              clientId: form.get('clientId'),
              contractId: form.get('contractId') || undefined,
              reference: form.get('reference'),
              description: form.get('description'),
              originalAmount: String(form.get('total')).replace(',', '.'),
              currency: 'BRL',
              issueDate,
              installments,
            }),
          }),
        'Recebível e parcelas cadastrados.',
        ['receivables'],
      ).then((succeeded) => {
        if (succeeded) {
          target.reset();
          setReceivableClientId('');
          setReceivableContractId('');
        }
      });
    } catch (caught) {
      setFeedback(`Erro: ${caught instanceof Error ? caught.message : 'valores inválidos'}`);
    }
  };

  const createPayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const installment = openInstallments.find((item) => item.id === form.get('installmentId'));
    if (!installment) {
      setFeedback('Erro: selecione uma parcela válida.');
      return;
    }
    const amount = String(form.get('amount')).replace(',', '.');
    const payload = {
      clientId: installment.clientId,
      reference: form.get('reference'),
      amount,
      currency: 'BRL',
      paidAt: form.get('paidAt'),
      method: form.get('method'),
      allocations: [{ installmentId: installment.id, amount }],
    };
    const payloadKey = JSON.stringify(payload);
    const currentAttempt = paymentAttempt.current;
    const idempotencyKey =
      currentAttempt?.payload === payloadKey ? currentAttempt.idempotencyKey : crypto.randomUUID();
    paymentAttempt.current = { payload: payloadKey, idempotencyKey };
    void finish(
      () =>
        api('/finance/payments', {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(payload),
        }),
      'Pagamento confirmado e alocado à parcela.',
      ['receivables', 'paymentReceivables', 'payments'],
    ).then((succeeded) => {
      if (succeeded) {
        paymentAttempt.current = undefined;
        target.reset();
      }
    });
  };

  const createExpense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    void finish(
      () =>
        api('/finance/expenses', {
          method: 'POST',
          body: JSON.stringify({
            clientId: form.get('clientId') || undefined,
            matterId: form.get('matterId') || undefined,
            responsibleUserId: form.get('responsibleUserId') || undefined,
            description: form.get('description'),
            category: form.get('category'),
            amount: String(form.get('amount')).replace(',', '.'),
            currency: 'BRL',
            incurredAt: form.get('incurredAt'),
            dueDate: form.get('dueDate') || undefined,
            reimbursable: form.get('reimbursable') === 'on',
          }),
        }),
      'Despesa cadastrada.',
      ['expenses', 'expenseSummary'],
    ).then((ok) => {
      if (ok) {
        target.reset();
        setExpenseClientId('');
      }
    });
  };

  const updateExpense = (event: FormEvent<HTMLFormElement>, expense: Expense) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void finish(
      () =>
        api(`/finance/expenses/${expense.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            clientId: form.get('clientId') || null,
            matterId: form.get('matterId') || null,
            responsibleUserId: form.get('responsibleUserId') || null,
            description: form.get('description'),
            category: form.get('category'),
            amount: String(form.get('amount')).replace(',', '.'),
            incurredAt: form.get('incurredAt'),
            dueDate: form.get('dueDate') || undefined,
            reimbursable: form.get('reimbursable') === 'on',
          }),
        }),
      'Despesa atualizada. A trilha de auditoria foi registrada.',
      ['expenses', 'expenseSummary'],
    ).then((ok) => {
      if (ok) setEditingExpense(undefined);
    });
  };

  const submitExpense = (expense: Expense) =>
    void finish(
      () => api(`/finance/expenses/${expense.id}/submit`, { method: 'POST' }),
      expenseSubmitSuccessMessage(expensePolicy.data),
      ['expenses', 'expenseSummary'],
    );

  const openExpenseDocument = async (documentId: string) => {
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await api<{ url: string }>(`/documents/${documentId}/download-url`);
      if (!result.url) throw new Error('Não foi possível obter o link do comprovante.');
      if (popup) popup.location.replace(result.url);
      else window.location.assign(result.url);
      setFeedback('Link seguro do comprovante aberto.');
    } catch (caught) {
      popup?.close();
      setFeedback(
        `Erro: ${caught instanceof ApiError || caught instanceof Error ? caught.message : 'comprovante não disponível'}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const decideExpense = (expense: Expense, decision: 'approve' | 'reject', reason?: string) =>
    void finish(
      () =>
        api(`/finance/expenses/${expense.id}/${decision}`, {
          method: 'POST',
          ...(reason ? { body: JSON.stringify({ reason }) } : {}),
        }),
      decision === 'approve' ? 'Despesa aprovada.' : 'Despesa rejeitada com justificativa.',
      ['expenses', 'expenseSummary'],
    ).then((ok) => {
      if (ok) setRejectingExpense(undefined);
    });

  const payExpense = (event: FormEvent<HTMLFormElement>, expense: Expense) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void finish(
      () =>
        api(`/finance/expenses/${expense.id}/payment`, {
          method: 'POST',
          body: JSON.stringify({
            amount: String(form.get('amount')).replace(',', '.'),
            paidAt: form.get('paidAt'),
            method: form.get('method'),
            reference: form.get('reference') || undefined,
          }),
        }),
      'Pagamento integral registrado no caixa.',
      ['expenses', 'expenseSummary'],
    ).then((ok) => {
      if (ok) setPayingExpense(undefined);
    });
  };

  const cancelExpense = (expense: Expense) =>
    void finish(
      () => api(`/finance/expenses/${expense.id}/cancel`, { method: 'POST' }),
      'Despesa cancelada e registrada no histórico.',
      ['expenses', 'expenseSummary'],
    );

  const saveExpenseApprovalPolicy = () => {
    if (expenseApprovalDraft === undefined) return;
    void finish(
      () =>
        api('/finance/expenses/approval-policy', {
          method: 'PATCH',
          body: JSON.stringify({ required: expenseApprovalDraft }),
        }),
      'Política de aprovação atualizada.',
      ['expensePolicy'],
    ).then((ok) => {
      if (ok) setExpenseApprovalDraft(undefined);
    });
  };

  const uploadExpenseDocument = (event: FormEvent<HTMLFormElement>, expense: Expense) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    form.set('expenseId', expense.id);
    form.set('visibility', 'INTERNAL');
    void finish(
      () => api('/documents', { method: 'POST', body: form }),
      'Comprovante anexado à despesa.',
      ['expenses'],
    ).then((ok) => {
      if (ok) target.reset();
    });
  };

  const addAdjustment = (event: FormEvent<HTMLFormElement>, installmentId: string) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    void finish(
      () =>
        api(`/finance/installments/${installmentId}/adjustments`, {
          method: 'POST',
          body: JSON.stringify({
            kind: form.get('kind'),
            amount: String(form.get('amount')).replace(',', '.'),
            reason: form.get('reason'),
            effectiveAt: form.get('effectiveAt'),
          }),
        }),
      'Ajuste financeiro aplicado.',
      ['receivables', 'paymentReceivables'],
    ).then((ok) => {
      if (ok) setAdjusting(undefined);
    });
  };

  const reversePayment = (event: FormEvent<HTMLFormElement>, payment: Payment) => {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get('reason');
    void finish(
      () =>
        api(`/finance/payments/${payment.id}/reversal`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        }),
      'Pagamento estornado.',
      ['payments', 'receivables', 'paymentReceivables'],
    ).then((ok) => {
      if (ok) setReversing(undefined);
    });
  };

  const requestPaymentChange = (event: FormEvent<HTMLFormElement>, payment: Payment) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = String(form.get('amount')).trim().replace(',', '.');
    const selectedDate = String(form.get('paidAt'));
    const paidAt =
      selectedDate === payment.paidAt.slice(0, 10)
        ? payment.paidAt
        : `${selectedDate}${payment.paidAt.slice(10)}`;
    void finish(
      () =>
        api(`/finance/payments/${payment.id}/change-requests`, {
          method: 'PATCH',
          body: JSON.stringify({
            reference: form.get('reference'),
            amount,
            paidAt,
            method: form.get('method'),
            externalId: String(form.get('externalId') ?? '').trim() || null,
            allocations: payment.allocations.map(({ installmentId, amount: allocated }) => ({
              installmentId,
              amount: allocated.trim().replace(',', '.'),
            })),
            reason: form.get('reason'),
          }),
        }),
      isAdministrator
        ? 'Pagamento corrigido com registro de estorno e substituição.'
        : 'Correção enviada ao Administrador para aprovação.',
      ['paymentChangeRequests', 'payments', 'receivables'],
    ).then((succeeded) => {
      if (succeeded) {
        setEditingPayment(undefined);
        paymentChangeRequests.reload();
      }
    });
  };

  const decidePaymentChange = async (
    request: PaymentChangeRequest,
    decision: 'approve' | 'reject',
  ) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await api(`/finance/payments/change-requests/${request.id}/${decision}`, {
        method: 'POST',
        ...(decision === 'reject'
          ? { body: JSON.stringify({ note: 'Recusado pelo Administrador.' }) }
          : {}),
      });
      setFeedback(
        decision === 'approve' ? 'Correção aprovada e aplicada.' : 'Solicitação recusada.',
      );
      paymentChangeRequests.reload();
      payments.reload();
      receivables.reload();
    } catch (caught) {
      setFeedback(
        `Erro: ${caught instanceof ApiError ? caught.message : 'solicitação não atualizada'}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <header className="page-title">
        <div>
          <p>Financeiro</p>
          <h1>Entradas, parcelas e pagamentos</h1>
          <span>
            Cadastre valores a receber, gere parcelas e confirme pagamentos com rastreabilidade.
          </span>
        </div>
        {(canCreateReceivable || canCreatePayment || canCreateExpense) && (
          <div className="segmented">
            {canCreateReceivable && (
              <button
                className={mode === 'receivable' ? 'active' : ''}
                onClick={() => setMode('receivable')}
              >
                Nova cobrança
              </button>
            )}
            {canCreatePayment && (
              <button
                className={mode === 'payment' ? 'active' : ''}
                onClick={() => setMode('payment')}
              >
                Receber pagamento
              </button>
            )}
            {canCreateExpense && (
              <button
                className={mode === 'expense' ? 'active' : ''}
                onClick={() => setMode('expense')}
              >
                Nova despesa
              </button>
            )}
          </div>
        )}
      </header>
      <OperationFeedback message={feedback} />
      <OperationFeedback
        message={
          (clients.error && !clients.data) || receivables.error || payments.error
            ? `Erro: ${(clients.error || receivables.error || payments.error)?.message}`
            : undefined
        }
      />
      {clients.error && !clients.data && (
        <button type="button" className="secondary" onClick={clients.retry}>
          Tentar carregar clientes novamente
        </button>
      )}
      {clients.data && (canCreateReceivable || canCreatePayment || canCreateExpense) && (
        <LoadMore
          shown={clients.data.items.length}
          total={clients.data.total}
          loading={clients.loading}
          error={clients.error}
          onLoad={clients.loadMore}
          onRetry={clients.retry}
        />
      )}
      {canCreateReceivable && mode === 'receivable' ? (
        <form className="surface form-grid" data-reveal onSubmit={createReceivable}>
          <label>
            Cliente
            <select
              required
              name="clientId"
              value={receivableClientId}
              onChange={(event) => {
                setReceivableClientId(event.target.value);
                setReceivableContractId('');
              }}
            >
              <option value="" disabled>
                Selecione
              </option>
              {clients.data?.items.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Contrato associado (opcional)
            <select
              name="contractId"
              value={receivableContractId}
              onChange={(event) => setReceivableContractId(event.target.value)}
              disabled={!receivableClientId || receivableContracts.loading}
            >
              <option value="">Sem vínculo com contrato</option>
              {receivableContracts.data?.items
                .filter((contract) => contract.clientId === receivableClientId)
                .map((contract) => (
                  <option value={contract.id} key={contract.id}>
                    {contract.number} · {contract.title}
                  </option>
                ))}
            </select>
            {receivableClientId && receivableContracts.error && (
              <small role="alert">
                Não foi possível carregar os contratos.{' '}
                <button type="button" onClick={receivableContracts.retry}>
                  Tentar novamente
                </button>
              </small>
            )}
          </label>
          <label>
            Código da cobrança
            <input name="reference" required placeholder="HON-2026-001" />
          </label>
          <label className="form-wide">
            Serviço ou motivo da cobrança
            <input name="description" required />
          </label>
          <label>
            Valor total
            <input name="total" required inputMode="decimal" placeholder="1500,00" />
          </label>
          <label>
            Entrada opcional
            <input name="entry" inputMode="decimal" placeholder="300,00" />
          </label>
          <label>
            Parcelas após entrada
            <input
              name="installmentCount"
              type="number"
              min="1"
              max="240"
              defaultValue="1"
              required
            />
          </label>
          <label>
            Data de emissão
            <input name="issueDate" type="date" defaultValue={today()} required />
          </label>
          <label>
            Primeiro vencimento
            <input name="firstDueDate" type="date" defaultValue={today()} required />
          </label>
          <button className="primary form-wide" disabled={busy}>
            {busy ? 'Salvando…' : 'Criar cobrança e parcelas'}
          </button>
        </form>
      ) : mode === 'payment' && canCreatePayment ? (
        <form className="surface form-grid" data-reveal onSubmit={createPayment}>
          <label>
            Cliente
            <select
              required
              value={selectedClient}
              onChange={(event) => setSelectedClient(event.target.value)}
            >
              <option value="" disabled>
                Selecione um cliente
              </option>
              {clients.data?.items.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="form-wide">
            Parcela
            <select required name="installmentId" defaultValue="">
              <option value="" disabled>
                Selecione uma parcela aberta
              </option>
              {openInstallments.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.clientName} · {item.reference} · parcela {item.sequence} ·{' '}
                  {formatMoney(item.remainingAmount)} em aberto
                </option>
              ))}
            </select>
          </label>
          {selectedClient && paymentReceivables.error && !paymentReceivables.data && (
            <div className="notice notice-error form-wide" role="alert">
              {paymentReceivables.error.message}{' '}
              <button type="button" onClick={paymentReceivables.retry}>
                Tentar novamente
              </button>
            </div>
          )}
          {selectedClient &&
            paymentReceivables.data &&
            !openInstallments.length &&
            paymentReceivables.data.items.length >= paymentReceivables.data.total && (
              <p className="form-wide">Nenhuma parcela aberta para este cliente.</p>
            )}
          {selectedClient && paymentReceivables.data && (
            <div className="form-wide">
              <LoadMore
                shown={paymentReceivables.data.items.length}
                total={paymentReceivables.data.total}
                loading={paymentReceivables.loading}
                error={paymentReceivables.error}
                onLoad={paymentReceivables.loadMore}
                onRetry={paymentReceivables.retry}
              />
            </div>
          )}
          <label>
            Referência do pagamento
            <input name="reference" required placeholder="PIX-0001" />
          </label>
          <label>
            Valor recebido
            <input name="amount" required inputMode="decimal" />
          </label>
          <label>
            Data do pagamento
            <input name="paidAt" type="datetime-local" required />
          </label>
          <label>
            Forma
            <select name="method" defaultValue="PIX">
              <option>PIX</option>
              <option>Transferência</option>
              <option>Boleto</option>
              <option>Cartão</option>
              <option>Dinheiro</option>
            </select>
          </label>
          <button className="primary form-wide" disabled={busy}>
            {busy ? 'Confirmando…' : 'Confirmar pagamento'}
          </button>
        </form>
      ) : mode === 'expense' && canCreateExpense ? (
        <form className="surface form-grid" data-reveal onSubmit={createExpense}>
          <label>
            Cliente
            <select
              name="clientId"
              value={expenseClientId}
              onChange={(event) => setExpenseClientId(event.target.value)}
            >
              <option value="">Sem vínculo</option>
              {clients.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Processo
            <select name="matterId" defaultValue="">
              <option value="">Sem vínculo</option>
              {expenseMatters.data?.items
                .filter((item) => !expenseClientId || item.client.id === expenseClientId)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.reference} · {item.client.displayName}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Responsável
            <select name="responsibleUserId" defaultValue="">
              <option value="">Sem responsável</option>
              {expenseResponsibles.data?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Categoria
            <input required name="category" minLength={2} />
          </label>
          <label className="form-wide">
            Detalhes da despesa
            <input required name="description" minLength={2} />
          </label>
          <label>
            Valor
            <input required name="amount" inputMode="decimal" placeholder="0,00" />
          </label>
          <label>
            Data da despesa
            <input required type="date" name="incurredAt" defaultValue={today()} />
          </label>
          <label>
            Vencimento
            <input required type="date" name="dueDate" />
          </label>
          <label className="check">
            <input type="checkbox" name="reimbursable" /> Despesa reembolsável
          </label>
          <button className="primary form-wide" disabled={busy}>
            Cadastrar despesa
          </button>
        </form>
      ) : null}
      {canViewReceivables && (
        <section ref={receivablesViewport.ref} className="section-block" data-reveal>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Contas a receber</p>
              <h2>Parcelas e recebíveis</h2>
            </div>
            <span>
              {receivables.data?.total ?? (receivablesViewport.visible ? 'Carregando…' : '—')}{' '}
              registros
            </span>
          </div>
          <div className="surface table-wrap" role="region" aria-label="Recebíveis" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Referência</th>
                  <th>Valor</th>
                  <th>Parcelas</th>
                  <th>Último vencimento</th>
                  <th>Status</th>
                  {canApproveReceivables && <th>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {receivables.data?.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.client.displayName}</td>
                    <td>
                      <strong>{item.reference}</strong>
                      <small>{item.description}</small>
                    </td>
                    <td>
                      {formatMoney(item.originalAmount, item.currency)}
                      <small>
                        Saldo em aberto: {formatMoney(receivableBalance(item), item.currency)}
                      </small>
                    </td>
                    <td>{item.installments.length}</td>
                    <td>{formatDate(item.dueDate)}</td>
                    <td>
                      <span className="badge">{item.status}</span>
                    </td>
                    {canApproveReceivables && (
                      <td>
                        {item.installments
                          .filter(
                            (part) => !['PAID', 'CANCELLED', 'RENEGOTIATED'].includes(part.status),
                          )
                          .map((part) => (
                            <button
                              className="table-action"
                              key={part.id}
                              onClick={() =>
                                setAdjusting(adjusting === part.id ? undefined : part.id)
                              }
                            >
                              Ajustar parcela {part.sequence}
                            </button>
                          ))}
                        {item.installments.map(
                          (part) =>
                            adjusting === part.id && (
                              <form
                                className="stack-form compact-form"
                                key={`form-${part.id}`}
                                onSubmit={(event) => addAdjustment(event, part.id)}
                              >
                                <label>
                                  Tipo
                                  <select name="kind" defaultValue="DISCOUNT">
                                    <option value="DISCOUNT">Desconto</option>
                                    <option value="INTEREST">Juros</option>
                                    <option value="PENALTY">Multa</option>
                                    <option value="CORRECTION">Correção</option>
                                    <option value="OTHER">Outro</option>
                                  </select>
                                </label>
                                <label>
                                  Valor
                                  <input required name="amount" inputMode="decimal" />
                                </label>
                                <label>
                                  Motivo
                                  <input required minLength={3} name="reason" />
                                </label>
                                <label>
                                  Data
                                  <input
                                    required
                                    type="date"
                                    name="effectiveAt"
                                    defaultValue={today()}
                                  />
                                </label>
                                <button className="secondary" disabled={busy}>
                                  Aplicar
                                </button>
                              </form>
                            ),
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {receivables.error && !receivables.data && (
            <div className="notice notice-error" role="alert">
              {receivables.error.message}{' '}
              <button onClick={receivables.retry}>Tentar novamente</button>
            </div>
          )}
          {receivables.data && (
            <LoadMore
              shown={receivables.data.items.length}
              total={receivables.data.total}
              loading={receivables.loading}
              error={receivables.error}
              onLoad={receivables.loadMore}
              onRetry={receivables.retry}
            />
          )}
        </section>
      )}
      {canViewPayments && (
        <section ref={paymentsViewport.ref} className="section-block" data-reveal>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Caixa</p>
              <h2>Pagamentos recebidos</h2>
            </div>
            <span>
              {payments.data?.total ?? (paymentsViewport.visible ? 'Carregando…' : '—')} registros
            </span>
          </div>
          <div className="surface table-wrap" role="region" aria-label="Pagamentos" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Referência</th>
                  <th>Valor</th>
                  <th>Forma</th>
                  <th>Data</th>
                  <th>Status</th>
                  {(canApprovePayments || canRequestPaymentChange) && <th>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {payments.data?.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.client.displayName}</td>
                    <td>{item.reference}</td>
                    <td>{formatMoney(item.amount, item.currency)}</td>
                    <td>{item.method}</td>
                    <td>{formatDate(item.paidAt)}</td>
                    <td>
                      <span className="badge">{item.status}</span>
                    </td>
                    {(canApprovePayments || canRequestPaymentChange) && (
                      <td>
                        {item.status === 'CONFIRMED' && (
                          <>
                            {canRequestPaymentChange && (
                              <button
                                className="table-action"
                                disabled={busy}
                                onClick={() => {
                                  setReversing(undefined);
                                  setEditingPayment(
                                    editingPayment?.id === item.id ? undefined : item,
                                  );
                                }}
                              >
                                Corrigir dados
                              </button>
                            )}
                            {canApprovePayments && (
                              <button
                                className="table-action"
                                disabled={busy}
                                onClick={() => {
                                  setEditingPayment(undefined);
                                  setReversing(reversing === item.id ? undefined : item.id);
                                }}
                              >
                                Estornar
                              </button>
                            )}
                            {editingPayment?.id === item.id && (
                              <form
                                className="stack-form compact-form payment-edit-form"
                                onSubmit={(event) => requestPaymentChange(event, editingPayment)}
                              >
                                <strong>Corrigir pagamento</strong>
                                <label>
                                  Referência
                                  <input
                                    required
                                    maxLength={100}
                                    name="reference"
                                    defaultValue={item.reference}
                                  />
                                </label>
                                <label>
                                  Valor recebido
                                  <input
                                    required
                                    inputMode="decimal"
                                    name="amount"
                                    defaultValue={item.amount}
                                  />
                                </label>
                                <label>
                                  Data do recebimento
                                  <input
                                    required
                                    type="date"
                                    name="paidAt"
                                    defaultValue={item.paidAt.slice(0, 10)}
                                  />
                                </label>
                                <label>
                                  Forma de pagamento
                                  <input
                                    required
                                    minLength={2}
                                    maxLength={80}
                                    name="method"
                                    defaultValue={item.method}
                                  />
                                </label>
                                <label>
                                  Identificador externo
                                  <input
                                    maxLength={160}
                                    name="externalId"
                                    defaultValue={item.externalId ?? ''}
                                  />
                                </label>
                                {editingPayment.allocations.map((allocation, index) => (
                                  <label key={allocation.installmentId}>
                                    Parcela {allocation.installment?.sequence ?? index + 1} ·{' '}
                                    {allocation.installment?.receivable.reference ?? 'cobrança'}
                                    <span className="inline-control">
                                      <input
                                        aria-label={`Valor alocado à parcela ${allocation.installment?.sequence ?? index + 1}`}
                                        inputMode="decimal"
                                        value={allocation.amount}
                                        onChange={(event) =>
                                          setEditingPayment((current) =>
                                            current
                                              ? {
                                                  ...current,
                                                  allocations: current.allocations.map(
                                                    (value, currentIndex) =>
                                                      currentIndex === index
                                                        ? { ...value, amount: event.target.value }
                                                        : value,
                                                  ),
                                                }
                                              : current,
                                          )
                                        }
                                      />
                                      <button
                                        type="button"
                                        className="table-action"
                                        onClick={() =>
                                          setEditingPayment((current) =>
                                            current
                                              ? {
                                                  ...current,
                                                  allocations: current.allocations.filter(
                                                    (_, i) => i !== index,
                                                  ),
                                                }
                                              : current,
                                          )
                                        }
                                      >
                                        Remover
                                      </button>
                                    </span>
                                  </label>
                                ))}
                                <label>
                                  Motivo da correção
                                  <textarea required minLength={3} maxLength={500} name="reason" />
                                </label>
                                <div className="form-actions">
                                  <button className="secondary" disabled={busy}>
                                    {isAdministrator ? 'Aplicar correção' : 'Enviar para aprovação'}
                                  </button>
                                  <button
                                    type="button"
                                    className="table-action"
                                    onClick={() => setEditingPayment(undefined)}
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              </form>
                            )}
                            {reversing === item.id && (
                              <form
                                className="stack-form compact-form"
                                onSubmit={(event) => reversePayment(event, item)}
                              >
                                <label>
                                  Motivo
                                  <input required minLength={3} maxLength={500} name="reason" />
                                </label>
                                <button className="secondary" disabled={busy}>
                                  Confirmar estorno
                                </button>
                              </form>
                            )}
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {payments.error && !payments.data && (
            <div className="notice notice-error" role="alert">
              {payments.error.message} <button onClick={payments.retry}>Tentar novamente</button>
            </div>
          )}
          {payments.data && (
            <LoadMore
              shown={payments.data.items.length}
              total={payments.data.total}
              loading={payments.loading}
              error={payments.error}
              onLoad={payments.loadMore}
              onRetry={payments.retry}
            />
          )}
        </section>
      )}
      {isAdministrator && canApprovePayments && canRequestPaymentChange && (
        <section ref={paymentChangeRequestsViewport.ref} className="section-block" data-reveal>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Revisão administrativa</p>
              <h2>Correções de pagamento pendentes</h2>
              <p>
                Aprovar estorna o lançamento original e registra a versão corrigida no histórico.
              </p>
            </div>
            <span>{paymentChangeRequests.data?.total ?? 0} solicitações</span>
          </div>
          {paymentChangeRequests.error && (
            <div className="notice notice-error" role="alert">
              {paymentChangeRequests.error.message}
              <button onClick={paymentChangeRequests.retry}>Tentar novamente</button>
            </div>
          )}
          <div className="payment-approval-list">
            {paymentChangeRequests.data?.items.map((request) => (
              <article className="surface payment-approval-card" key={request.id}>
                <div>
                  <p className="eyebrow">{request.payment.client.displayName}</p>
                  <h3>{request.payment.reference}</h3>
                  <p>Solicitado por {request.requestedByName}</p>
                  <p>Motivo: {request.reason}</p>
                </div>
                <dl>
                  <div>
                    <dt>Valor atual</dt>
                    <dd>{formatMoney(request.payment.amount, request.payment.currency)}</dd>
                  </div>
                  <div>
                    <dt>Novo valor</dt>
                    <dd>{formatMoney(request.proposedData.amount, request.payment.currency)}</dd>
                  </div>
                  <div>
                    <dt>Forma</dt>
                    <dd>
                      {request.payment.method} → {request.proposedData.method}
                    </dd>
                  </div>
                  <div>
                    <dt>Data</dt>
                    <dd>
                      {formatDate(request.payment.paidAt)} →{' '}
                      {formatDate(request.proposedData.paidAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>Referência</dt>
                    <dd>
                      {request.payment.reference} → {request.proposedData.reference}
                    </dd>
                  </div>
                  <div>
                    <dt>Parcelas vinculadas</dt>
                    <dd>{request.proposedData.allocations.length}</dd>
                  </div>
                </dl>
                <div className="form-actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void decidePaymentChange(request, 'approve')}
                  >
                    Aprovar e corrigir
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void decidePaymentChange(request, 'reject')}
                  >
                    Recusar
                  </button>
                </div>
              </article>
            ))}
            {paymentChangeRequests.data && !paymentChangeRequests.data.items.length && (
              <div className="surface empty">
                <strong>Nenhuma correção pendente</strong>
                <span>Novas solicitações de pagamento aparecerão aqui.</span>
              </div>
            )}
          </div>
        </section>
      )}
      {!isAdministrator && canRequestPaymentChange ? (
        <section ref={paymentChangeRequestsViewport.ref} className="section-block" data-reveal>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Acompanhamento</p>
              <h2>Minhas correções de pagamento</h2>
            </div>
          </div>
          <div className="surface table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pagamento</th>
                  <th>Motivo</th>
                  <th>Status</th>
                  <th>Retorno</th>
                </tr>
              </thead>
              <tbody>
                {paymentChangeRequests.data?.items.map((request) => (
                  <tr key={request.id}>
                    <td>{request.payment.reference}</td>
                    <td>{request.reason}</td>
                    <td>
                      {request.status === 'PENDING'
                        ? 'Aguardando Administrador'
                        : request.status === 'APPROVED'
                          ? 'Aprovada'
                          : 'Recusada'}
                    </td>
                    <td>{request.reviewNote || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {canViewExpenses && (
        <section ref={expensesViewport.ref} className="section-block" data-reveal>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Saídas</p>
              <h2>Despesas</h2>
            </div>
            <span>
              {expenses.data?.total ?? (expensesViewport.visible ? 'Carregando…' : '—')} registros
            </span>
          </div>
          <p className="section-description">
            Acompanhe vencimentos, aprovações e pagamentos. Pagamentos são registrados como quitação
            integral. A marcação de reembolso é informativa: não cria cobrança nem receita.
          </p>
          {canManageExpensePolicy && (
            <div className="surface expense-policy">
              <label>
                Aprovação obrigatória
                <select
                  value={
                    (expenseApprovalDraft ?? expensePolicy.data?.required ?? true) ? 'yes' : 'no'
                  }
                  onChange={(event) => setExpenseApprovalDraft(event.target.value === 'yes')}
                  disabled={!expensePolicy.data || busy}
                >
                  <option value="yes">Sim, exigir aprovação</option>
                  <option value="no">Não, liberar para pagamento após envio</option>
                </select>
              </label>
              <p className="form-wide">
                A política vale para novos envios. Despesas já pendentes continuam aguardando
                decisão; para retirá-las do fluxo, cancele e cadastre novamente após alterar a
                política.
              </p>
              <button
                className="secondary"
                disabled={busy || !expensePolicy.data || expenseApprovalDraft === undefined}
                onClick={saveExpenseApprovalPolicy}
              >
                Salvar política
              </button>
            </div>
          )}
          {expensePolicy.data?.required && !expensePolicy.data.canSubmitForApproval && (
            <div role="alert" className="notice notice-error">
              Não há outro membro ativo com permissão de aprovação. Para evitar uma solicitação sem
              destino, desative a aprovação antes de confirmar esta despesa ou habilite outro
              aprovador.
            </div>
          )}
          {expensePolicy.error && (
            <div role="alert" className="notice notice-error">
              Não foi possível carregar a política de aprovação: {expensePolicy.error.message}
            </div>
          )}
          {expenseSummary.data && (
            <div className="expense-summary-list">
              {expenseSummary.data.currencies.map((summary) => (
                <dl className="expense-summary" key={summary.currency}>
                  <div className="expense-summary-currency">
                    <dt>Moeda</dt>
                    <dd>{summary.currency}</dd>
                  </div>
                  <div>
                    <dt>Aguardando aprovação</dt>
                    <dd>
                      {formatMoney(summary.pendingApproval.amount, summary.currency)} ·{' '}
                      {summary.pendingApproval.count}
                    </dd>
                  </div>
                  <div>
                    <dt>Aguardando pagamento</dt>
                    <dd>
                      {formatMoney(summary.pendingPayment.amount, summary.currency)} ·{' '}
                      {summary.pendingPayment.count}
                    </dd>
                  </div>
                  <div>
                    <dt>Vencidas</dt>
                    <dd>
                      {formatMoney(summary.overdue.amount, summary.currency)} ·{' '}
                      {summary.overdue.count}
                    </dd>
                  </div>
                  <div>
                    <dt>Pagas no período</dt>
                    <dd>
                      {formatMoney(summary.paid.amount, summary.currency)} · {summary.paid.count}
                    </dd>
                  </div>
                </dl>
              ))}
            </div>
          )}
          <div className="surface expense-filters">
            <label>
              Status
              <select
                value={expenseStatusFilter}
                onChange={(event) => setExpenseStatusFilter(event.target.value)}
              >
                <option value="">Todos</option>
                {Object.entries(expenseStatusLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Categoria
              <input
                value={expenseCategoryFilter}
                onChange={(event) => setExpenseCategoryFilter(event.target.value)}
              />
            </label>
            <label>
              Filtrar data por
              <select
                value={expensePeriodFilter}
                onChange={(event) => setExpensePeriodFilter(event.target.value)}
              >
                <option value="dueDate">Vencimento</option>
                <option value="incurredAt">Data da despesa</option>
                <option value="paidAt">Pagamento</option>
              </select>
            </label>
            <label>
              De
              <input
                type="date"
                value={expenseFrom}
                onChange={(event) => setExpenseFrom(event.target.value)}
              />
            </label>
            <label>
              Até
              <input
                type="date"
                value={expenseTo}
                onChange={(event) => setExpenseTo(event.target.value)}
              />
            </label>
          </div>
          {expenses.error && !expenses.data ? (
            <div className="notice notice-error" role="alert">
              {expenses.error.message}
            </div>
          ) : (
            <div className="surface table-wrap" role="region" aria-label="Despesas" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th>Vínculo</th>
                    <th>Categoria e responsável</th>
                    <th>Valor</th>
                    <th>Vencimento</th>
                    <th>Status</th>
                    <th>Comprovantes e ações</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.data?.items.map((item) => (
                    <Fragment key={item.id}>
                      <tr>
                        <td>
                          {item.description}
                          <small>Data: {formatDate(item.incurredAt)}</small>
                        </td>
                        <td>
                          {item.client?.displayName ?? 'Sem cliente'}
                          {item.matter && <small>Processo {item.matter.reference}</small>}
                        </td>
                        <td>
                          {item.category}
                          <small>{item.responsibleUser?.fullName ?? 'Sem responsável'}</small>
                        </td>
                        <td>{formatMoney(item.amount, item.currency)}</td>
                        <td>
                          {item.dueDate ? formatDate(item.dueDate) : 'Sem vencimento'}
                          {item.paidAt && <small>Pago em {formatDate(item.paidAt)}</small>}
                        </td>
                        <td>
                          <span className="badge">
                            {expenseStatusLabels[item.status] ?? item.status}
                          </span>
                          {item.rejectionReason && <small>Motivo: {item.rejectionReason}</small>}
                        </td>
                        <td>
                          {canViewDocuments && Boolean(item.documents?.length) && (
                            <ul className="expense-document-list">
                              {item.documents?.map((document) => (
                                <li key={document.id}>
                                  <button
                                    type="button"
                                    className="table-action"
                                    disabled={busy}
                                    onClick={() => void openExpenseDocument(document.id)}
                                  >
                                    Visualizar comprovante: {document.title}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="expense-actions">
                            <button
                              type="button"
                              className="table-action"
                              disabled={busy}
                              aria-expanded={expenseHistoryId === item.id}
                              onClick={() =>
                                setExpenseHistoryId(
                                  expenseHistoryId === item.id ? undefined : item.id,
                                )
                              }
                            >
                              {expenseHistoryId === item.id ? 'Fechar histórico' : 'Histórico'}
                            </button>
                            {canUpdateExpenses && ['DRAFT', 'REJECTED'].includes(item.status) && (
                              <button
                                className="table-action"
                                disabled={busy}
                                onClick={() =>
                                  setEditingExpense(
                                    editingExpense?.id === item.id ? undefined : item,
                                  )
                                }
                              >
                                Editar
                              </button>
                            )}
                            {canUpdateExpenses && ['DRAFT', 'REJECTED'].includes(item.status) && (
                              <button
                                className="table-action"
                                disabled={busy || !canSubmitExpense(expensePolicy.data)}
                                onClick={() => void submitExpense(item)}
                              >
                                {expenseSubmitButtonLabel(expensePolicy.data)}
                              </button>
                            )}
                            {canApproveExpenses && item.status === 'PENDING_APPROVAL' && (
                              <button
                                className="table-action"
                                disabled={busy}
                                onClick={() => void decideExpense(item, 'approve')}
                              >
                                Aprovar
                              </button>
                            )}
                            {canApproveExpenses && item.status === 'PENDING_APPROVAL' && (
                              <button
                                className="table-action"
                                disabled={busy}
                                onClick={() =>
                                  setRejectingExpense(
                                    rejectingExpense === item.id ? undefined : item.id,
                                  )
                                }
                              >
                                Rejeitar
                              </button>
                            )}
                            {canUpdateExpenses && item.status === 'APPROVED' && (
                              <button
                                className="table-action"
                                disabled={busy}
                                onClick={() =>
                                  setPayingExpense(payingExpense === item.id ? undefined : item.id)
                                }
                              >
                                Registrar pagamento
                              </button>
                            )}
                            {canUpdateExpenses && !['PAID', 'CANCELLED'].includes(item.status) && (
                              <button
                                className="table-action"
                                disabled={busy}
                                onClick={() => cancelExpense(item)}
                              >
                                Cancelar
                              </button>
                            )}
                            {canCreateDocuments && !['CANCELLED'].includes(item.status) && (
                              <form
                                className="expense-upload"
                                onSubmit={(event) => uploadExpenseDocument(event, item)}
                              >
                                <label>
                                  Adicionar comprovante
                                  <input
                                    required
                                    type="file"
                                    name="file"
                                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                                  />
                                </label>
                                <input
                                  required
                                  name="title"
                                  aria-label="Título do comprovante"
                                  placeholder="Título do comprovante"
                                />
                                <input type="hidden" name="category" value="COMPROVANTE_DESPESA" />
                                <button className="table-action" disabled={busy}>
                                  Anexar
                                </button>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expenseHistoryId === item.id && (
                        <tr key={`${item.id}-history`}>
                          <td colSpan={7}>
                            <ExpenseHistoryPanel expenseId={item.id} />
                          </td>
                        </tr>
                      )}
                      {editingExpense?.id === item.id && (
                        <tr key={`${item.id}-edit`}>
                          <td colSpan={7}>
                            <form
                              className="form-grid expense-edit-form"
                              onSubmit={(event) => updateExpense(event, item)}
                            >
                              <label>
                                Cliente
                                <select name="clientId" defaultValue={item.clientId ?? ''}>
                                  <option value="">Sem vínculo</option>
                                  {clients.data?.items.map((client) => (
                                    <option value={client.id} key={client.id}>
                                      {client.displayName}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Processo
                                <select name="matterId" defaultValue={item.matterId ?? ''}>
                                  <option value="">Sem vínculo</option>
                                  {expenseMatters.data?.items
                                    .filter(
                                      (matter) =>
                                        !item.clientId || matter.client.id === item.clientId,
                                    )
                                    .map((matter) => (
                                      <option key={matter.id} value={matter.id}>
                                        {matter.reference}
                                      </option>
                                    ))}
                                </select>
                              </label>
                              <label>
                                Responsável
                                <select
                                  name="responsibleUserId"
                                  defaultValue={item.responsibleUserId ?? ''}
                                >
                                  <option value="">Sem responsável</option>
                                  {expenseResponsibles.data?.map((user) => (
                                    <option key={user.id} value={user.id}>
                                      {user.fullName}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Categoria
                                <input name="category" required defaultValue={item.category} />
                              </label>
                              <label>
                                Valor
                                <input
                                  name="amount"
                                  required
                                  inputMode="decimal"
                                  defaultValue={item.amount}
                                />
                              </label>
                              <label>
                                Vencimento
                                <input
                                  name="dueDate"
                                  type="date"
                                  required
                                  defaultValue={item.dueDate?.slice(0, 10) ?? ''}
                                />
                              </label>
                              <label className="form-wide">
                                Descrição
                                <input
                                  name="description"
                                  required
                                  defaultValue={item.description}
                                />
                              </label>
                              <label>
                                Data da despesa
                                <input
                                  name="incurredAt"
                                  type="date"
                                  required
                                  defaultValue={item.incurredAt.slice(0, 10)}
                                />
                              </label>
                              <label className="check">
                                <input
                                  type="checkbox"
                                  name="reimbursable"
                                  defaultChecked={item.reimbursable}
                                />{' '}
                                Despesa reembolsável
                              </label>
                              <div className="form-actions form-wide">
                                <button className="primary" disabled={busy}>
                                  Salvar alteração
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() => setEditingExpense(undefined)}
                                >
                                  Fechar
                                </button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      )}
                      {payingExpense === item.id && (
                        <tr key={`${item.id}-pay`}>
                          <td colSpan={7}>
                            <form
                              className="form-grid expense-edit-form"
                              onSubmit={(event) => payExpense(event, item)}
                            >
                              <label>
                                Valor integral
                                <input
                                  required
                                  name="amount"
                                  inputMode="decimal"
                                  defaultValue={item.amount}
                                />
                              </label>
                              <label>
                                Data do pagamento
                                <input required type="date" name="paidAt" defaultValue={today()} />
                              </label>
                              <label>
                                Forma de pagamento
                                <input required name="method" defaultValue="PIX" />
                              </label>
                              <label>
                                Referência
                                <input name="reference" maxLength={160} />
                              </label>
                              <div className="form-actions form-wide">
                                <button className="primary" disabled={busy}>
                                  Confirmar quitação integral
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() => setPayingExpense(undefined)}
                                >
                                  Fechar
                                </button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      )}
                      {rejectingExpense === item.id && (
                        <tr key={`${item.id}-reject`}>
                          <td colSpan={7}>
                            <form
                              className="form-grid expense-edit-form"
                              onSubmit={(event) => {
                                event.preventDefault();
                                const reason = String(
                                  new FormData(event.currentTarget).get('reason') ?? '',
                                ).trim();
                                void decideExpense(item, 'reject', reason);
                              }}
                            >
                              <label className="form-wide">
                                Motivo da rejeição
                                <textarea required minLength={3} maxLength={500} name="reason" />
                              </label>
                              <div className="form-actions form-wide">
                                <button className="secondary" disabled={busy}>
                                  Registrar rejeição
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() => setRejectingExpense(undefined)}
                                >
                                  Fechar
                                </button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {expenses.data && (
            <LoadMore
              shown={expenses.data.items.length}
              total={expenses.data.total}
              loading={expenses.loading}
              error={expenses.error}
              onLoad={expenses.loadMore}
              onRetry={expenses.retry}
            />
          )}
          {expenses.data && expenses.data.items.length === 0 && (
            <div className="surface empty">
              <strong>Nenhuma despesa neste filtro</strong>
              <span>Altere o período, status ou categoria.</span>
            </div>
          )}
          {expenseSummary.error && (
            <div className="notice notice-error" role="alert">
              Falha ao carregar o resumo financeiro: {expenseSummary.error.message}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
