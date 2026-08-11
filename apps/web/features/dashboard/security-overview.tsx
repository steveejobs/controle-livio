import { Card } from '@livio/ui';

const protections = [
  'Autorização granular',
  'Contexto multiempresa',
  'Logs com redação',
  'Auditoria preparada',
] as const;

export function SecurityOverview() {
  return (
    <Card className="security-card" id="security" data-reveal data-reveal-order="2">
      <p className="eyebrow">Proteção em camadas</p>
      <h2>Segurança verificável</h2>
      <div className="security-score">
        <span>100</span>
        <small>
          % das rotas
          <br />
          negadas por padrão
        </small>
      </div>
      <ul className="check-list">
        {protections.map((protection) => (
          <li key={protection}>{protection}</li>
        ))}
      </ul>
    </Card>
  );
}
