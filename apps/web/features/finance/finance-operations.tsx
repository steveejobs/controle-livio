'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { addMonths, decimalToCents, formatDate, formatMoney, splitAmount } from '../shared/format';
import { LoadMore } from '../shared/load-more';
import { usePaginatedData } from '../shared/use-paginated-data';

type Client = { id: string; displayName: string };
type Installment = {
  id: string;
  sequence: number;
  amount: string;
  dueDate: string;
  status: string;
  allocations: Array<{ amount: string }>;
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
  description: string;
  category: string;
  amount: string;
  currency: string;
  status: string;
  incurredAt: string;
  dueDate?: string;
  reimbursable: boolean;
  client?: Client;
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

export function FinanceOperations({
  permissions,
  isAdministrator,
}: {
  permissions: readonly string[];
  isAdministrator: boolean;
}) {
  const canCreateReceivable = permissions.includes('receivables:create');
  const canCreatePayment = permissions.includes('payments:create');
  const canViewPayments = permissions.includes('payments:view');
  const canApprovePayments = isAdministrator && permissions.includes('payments:approve');
  const canRequestPaymentChange = permissions.includes('payments:update');
  const canApproveReceivables = permissions.includes('receivables:approve');
  const canCreateExpense = permissions.includes('expenses:create');
  const canViewExpenses = permissions.includes('expenses:view');
  const clients = usePaginatedData<Client>(
    permissions.includes('clients:view') ? '/clients' : undefined,
    100,
  );
  const [mode, setMode] = useState<'receivable' | 'payment' | 'expense'>(
    canCreateReceivable ? 'receivable' : 'payment',
  );
  const [selectedClient, setSelectedClient] = useState('');
  const receivables = usePaginatedData<Receivable>('/finance/receivables');
  const payments = usePaginatedData<Payment>(canViewPayments ? '/finance/payments' : undefined);
  const paymentChangeRequests = usePaginatedData<PaymentChangeRequest>(
    canRequestPaymentChange ? '/finance/payments/change-requests' : undefined,
  );
  const expenses = usePaginatedData<Expense>(canViewExpenses ? '/finance/expenses' : undefined);
  const paymentReceivables = usePaginatedData<Receivable>(
    mode === 'payment' && selectedClient
      ? `/finance/receivables?clientId=${encodeURIComponent(selectedClient)}`
      : undefined,
  );
  const [adjusting, setAdjusting] = useState<string>();
  const [reversing, setReversing] = useState<string>();
  const [editingPayment, setEditingPayment] = useState<Payment>();
  const [feedback, setFeedback] = useState<string>();
  const [busy, setBusy] = useState(false);

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
              clientId: item.clientId,
              reference: item.reference,
              clientName: item.client.displayName,
            })),
        ),
    [paymentReceivables.data, selectedClient],
  );

  const finish = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      setFeedback(success);
      receivables.reload();
      paymentReceivables.reload();
      payments.reload();
      expenses.reload();
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
              reference: form.get('reference'),
              description: form.get('description'),
              originalAmount: String(form.get('total')).replace(',', '.'),
              currency: 'BRL',
              issueDate,
              installments,
            }),
          }),
        'Recebível e parcelas cadastrados.',
      ).then((succeeded) => {
        if (succeeded) target.reset();
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
    const idempotencyKey = crypto.randomUUID();
    void finish(
      () =>
        api('/finance/payments', {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({
            clientId: installment.clientId,
            reference: form.get('reference'),
            amount,
            currency: 'BRL',
            paidAt: form.get('paidAt'),
            method: form.get('method'),
            allocations: [{ installmentId: installment.id, amount }],
          }),
        }),
      'Pagamento confirmado e alocado à parcela.',
    ).then((succeeded) => {
      if (succeeded) target.reset();
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
            <select required name="clientId" defaultValue="">
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
                  {formatMoney(item.amount)}
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
            <select name="clientId" defaultValue="">
              <option value="">Sem vínculo</option>
              {clients.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
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
            <input type="date" name="dueDate" />
          </label>
          <label className="check">
            <input type="checkbox" name="reimbursable" /> Reembolsável pelo cliente
          </label>
          <button className="primary form-wide" disabled={busy}>
            Cadastrar despesa
          </button>
        </form>
      ) : null}
      <section className="section-block" data-reveal>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Contas a receber</p>
            <h2>Parcelas e recebíveis</h2>
          </div>
          <span>{receivables.data?.total ?? 0} registros</span>
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
                  <td>{formatMoney(item.originalAmount, item.currency)}</td>
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
      {canViewPayments && (
        <section className="section-block" data-reveal>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Caixa</p>
              <h2>Pagamentos recebidos</h2>
            </div>
            <span>{payments.data?.total ?? 0} registros</span>
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
        <section className="section-block" data-reveal>
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
      {!isAdministrator && canRequestPaymentChange && paymentChangeRequests.data?.items.length ? (
        <section className="section-block" data-reveal>
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
                {paymentChangeRequests.data.items.map((request) => (
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
        <section className="section-block" data-reveal>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Saídas</p>
              <h2>Despesas</h2>
            </div>
            <span>{expenses.data?.total ?? 0} registros</span>
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
                    <th>Cliente</th>
                    <th>Categoria</th>
                    <th>Valor</th>
                    <th>Data</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.data?.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.description}</td>
                      <td>{item.client?.displayName ?? '—'}</td>
                      <td>{item.category}</td>
                      <td>{formatMoney(item.amount, item.currency)}</td>
                      <td>{formatDate(item.incurredAt)}</td>
                      <td>
                        <span className="badge">{item.status}</span>
                      </td>
                    </tr>
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
        </section>
      )}
    </section>
  );
}
