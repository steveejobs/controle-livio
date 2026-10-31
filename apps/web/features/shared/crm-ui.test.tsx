import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { Notice } from './crm-ui';

describe('authentication notices', () => {
  it('shows the actual reason for a rejected login', () => {
    const html = renderToStaticMarkup(
      <Notice error={new ApiError(401, 'E-mail ou senha inválidos.')} />,
    );
    expect(html).toContain('E-mail ou senha inválidos.');
    expect(html).not.toContain('sessão expirou');
  });

  it('shows when an authenticated account lacks an active organization', () => {
    const html = renderToStaticMarkup(
      <Notice error={new ApiError(401, 'Usuário sem vínculo ativo com esta organização')} />,
    );
    expect(html).toContain('Usuário sem vínculo ativo com esta organização');
  });
});
