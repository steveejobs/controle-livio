'use client';

import { useState, type FormEvent } from 'react';
import { ProductBrand } from '../../components/product-brand';
import { createSupabaseBrowserClient } from '../../lib/supabase/client';

export default function ResetPasswordPage() {
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    const { error } = await createSupabaseBrowserClient().auth.updateUser({ password });
    setMessage(
      error
        ? 'Não foi possível alterar a senha. Solicite um novo link.'
        : 'Senha alterada. Você já pode entrar.',
    );
    setBusy(false);
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
          {message && (
            <div className="notice notice-success" role="status">
              {message}
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
