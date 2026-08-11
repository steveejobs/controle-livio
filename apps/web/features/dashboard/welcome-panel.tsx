import { Badge } from '@livio/ui';
import { PointerSurface } from '../../components/pointer-surface';

export function WelcomePanel() {
  return (
    <PointerSurface className="welcome-panel" aria-labelledby="welcome-title">
      <div className="welcome-copy">
        <Badge tone="success">Arquitetura pronta</Badge>
        <h2 id="welcome-title">O trabalho jurídico, organizado de ponta a ponta.</h2>
        <p>
          Uma base única para relacionamento, operação jurídica e controle financeiro, com segurança
          por padrão.
        </p>
      </div>
      <div className="monogram" aria-hidden="true">
        <span>L</span>
      </div>
    </PointerSurface>
  );
}
