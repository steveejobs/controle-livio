'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { addMonths, decimalToCents, formatDate, formatMoney, splitAmount } from '../shared/format';
import { useApiData } from '../shared/use-api-data';

type Client = { id: string; displayName: string };
type Page<T> = { items: T[]; total: number };
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
  client: Client;
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

export function FinanceOperations({ permissions }: { permissions: readonly string[] }) {
  const canCreateReceivable = permissions.includes('receivables:create');
  const canCreatePayment = permissions.includes('payments:create');
  const canViewPayments = permissions.includes('payments:view');
  const clients = useApiData<Page<Client>>('/clients?pageSize=100');
  const receivables = useApiData<Page<Receivable>>('/finance/receivables?pageSize=100');
  const payments = useApiData<Page<Payment>>(
    canViewPayments ? '/finance/payments?pageSize=100' : undefined,
  );
  const [mode, setMode] = useState<'receivable' | 'payment'>(
    canCreateReceivable ? 'receivable' : 'payment',
  );
  const [selectedClient, setSelectedClient] = useState('');
  const [feedback, setFeedback] = useState<string>();
  const [busy, setBusy] = useState(false);

  const openInstallments = useMemo(
    () =>
      (receivables.data?.items ?? [])
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
    [receivables.data, selectedClient],
  );

  const finish = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      setFeedback(success);
      receivables.reload();
      payments.reload();
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
        {(canCreateReceivable || canCreatePayment) && (
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
          </div>
        )}
      </header>
      <OperationFeedback message={feedback} />
      <OperationFeedback
        message={
          clients.error || receivables.error || payments.error
            ? `Erro: ${(clients.error || receivables.error || payments.error)?.message}`
            : undefined
        }
      />
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
            Referência
            <input name="reference" required placeholder="HON-2026-001" />
          </label>
          <label className="form-wide">
            Descrição
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
      ) : canCreatePayment ? (
        <form className="surface form-grid" data-reveal onSubmit={createPayment}>
          <label>
            Cliente
            <select
              value={selectedClient}
              onChange={(event) => setSelectedClient(event.target.value)}
            >
              <option value="">Todos</option>
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
      ) : null}
      <section className="section-block" data-reveal>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Contas a receber</p>
            <h2>Parcelas e recebíveis</h2>
          </div>
          <span>{receivables.data?.total ?? 0} registros</span>
        </div>
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Referência</th>
                <th>Valor</th>
                <th>Parcelas</th>
                <th>Último vencimento</th>
                <th>Status</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          <div className="surface table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Referência</th>
                  <th>Valor</th>
                  <th>Forma</th>
                  <th>Data</th>
                  <th>Status</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
