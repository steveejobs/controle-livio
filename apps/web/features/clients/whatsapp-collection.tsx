'use client';

import { useEffect, useState } from 'react';
import { formatMoney } from '../shared/format';
import type { ClientOverview } from './client.types';

export function normalizeWhatsAppPhone(value: string): string | null {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+') && /^\d{10,15}$/.test(digits)) return digits;
  if (/^55\d{10,11}$/.test(digits)) return digits;
  if (/^\d{10,11}$/.test(digits)) return `55${digits}`;
  return null;
}

export function WhatsAppCollection({
  client,
  contacts,
  outstanding,
}: {
  client: ClientOverview['client'];
  contacts: ClientOverview['contacts'];
  outstanding: ClientOverview['financial']['outstanding'];
}) {
  const phones = [
    ...(client.phone ? [{ key: 'client', label: client.displayName, phone: client.phone }] : []),
    ...contacts
      .filter((contact) => contact.phone)
      .map((contact) => ({ key: contact.id, label: contact.name, phone: contact.phone! })),
  ];
  const balances = outstanding.filter((item) => item.amount.replace(/[.,0]/g, '') !== '');
  const [phoneKey, setPhoneKey] = useState(phones[0]?.key ?? '');
  const [currency, setCurrency] = useState(balances[0]?.currency ?? 'BRL');
  const selectedPhone = phones.find((item) => item.key === phoneKey) ?? phones[0];
  const balance = balances.find((item) => item.currency === currency) ?? balances[0];
  const recipient = selectedPhone ? normalizeWhatsAppPhone(selectedPhone.phone) : null;
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!balance) {
      setMessage('');
      return;
    }
    const firstName = (selectedPhone?.label ?? client.displayName).trim().split(/\s+/)[0];
    setMessage(
      `Olá, ${firstName}. Tudo bem? Consta em aberto o valor de ${formatMoney(balance.amount, balance.currency)} em sua conta conosco. Poderia nos informar uma previsão de pagamento? Se já realizou o pagamento, por favor desconsidere esta mensagem e nos envie o comprovante. Obrigado.`,
    );
  }, [balance?.amount, balance?.currency, client.displayName, selectedPhone?.label]);

  if (!balances.length) return null;
  const url =
    recipient && message.trim()
      ? `https://wa.me/${recipient}?text=${encodeURIComponent(message.trim())}`
      : null;

  return (
    <section className="whatsapp-collection" aria-labelledby="whatsapp-collection-title">
      <h3 id="whatsapp-collection-title">Cobrar pelo WhatsApp</h3>
      <p className="section-note">
        Confira o destinatário e a mensagem. O WhatsApp conectado neste aparelho abrirá a conversa
        para você enviar.
      </p>
      <div className="whatsapp-collection-fields">
        <label>
          Enviar para
          <select
            value={selectedPhone?.key ?? ''}
            onChange={(event) => setPhoneKey(event.target.value)}
            disabled={!phones.length}
          >
            {!phones.length && <option value="">Nenhum telefone cadastrado</option>}
            {phones.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label} · {item.phone}
              </option>
            ))}
          </select>
        </label>
        {balances.length > 1 && (
          <label>
            Valor a cobrar
            <select
              value={balance?.currency ?? ''}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {balances.map((item) => (
                <option key={item.currency} value={item.currency}>
                  {formatMoney(item.amount, item.currency)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!recipient && (
        <p role="alert" className="field-error">
          Cadastre um telefone válido com DDD para abrir o WhatsApp.
        </p>
      )}
      <label>
        Mensagem
        <textarea
          value={message}
          maxLength={1800}
          rows={5}
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      {url && (
        <a
          className="primary whatsapp-collection-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Abrir conversa no WhatsApp
        </a>
      )}
    </section>
  );
}
