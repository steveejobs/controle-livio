'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ProductBrand } from '../../components/product-brand';
import { createSupabaseBrowserClient } from '../../lib/supabase/client';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirmation') ?? '')) {
      setMessage({ text: 'As senhas informadas não coincidem.', error: true });
      setBusy(false);
      return;
    }
    const { error } = await createSupabaseBrowserClient().auth.updateUser({ password });
    setMessage({
      text: error
        ? 'Não foi possível alterar a senha. Solicite um novo link.'
        : 'Senha alterada. Abrindo o sistema…',
      error: Boolean(error),
    });
    setBusy(false);
    if (!error) router.push('/');
  }

  return (
    <main className="auth-screen">
      <section className="auth-card reset-card">
        <ProductBrand compact />
        <p className="auth-eyebrow">Área segura</p>
        <h2>Defina uma nova senha</h2>
        <p>Use pelo menos 12 caracteres e não reutilize senhas de outros serviços.</p>
        <form onSubmit={submit}>
          <label>
            Nova senha
            <input
              required
              minLength={12}
              name="password"
              type="password"
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirme a nova senha
            <input
              required
              minLength={12}
              name="confirmation"
              type="password"
              autoComplete="new-password"
            />
          </label>
          {message && (
            <div
              className={`notice ${message.error ? 'notice-error' : 'notice-success'}`}
              role={message.error ? 'alert' : 'status'}
            >
              {message.text}
            </div>
          )}
          <button className="primary" disabled={busy}>
            {busy ? 'Salvando...' : 'Salvar nova senha'}
          </button>
        </form>
      </section>
    </main>
  );
}
