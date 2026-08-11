import { Badge, Card } from '@livio/ui';
import { productModules } from './dashboard.data';

export function ModulesOverview() {
  return (
    <Card className="modules-card" id="modules" data-reveal data-reveal-order="1">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Domínios</p>
          <h2>Módulos integrados</h2>
        </div>
        <Badge>4 núcleos</Badge>
      </div>
      <div className="module-list">
        {productModules.map((module) => (
          <article className="module-item" key={module.name}>
            <span className="module-icon">{module.icon}</span>
            <span>
              <strong>{module.name}</strong>
              <small>{module.detail}</small>
            </span>
            <span className="ready-mark" aria-label="Configurado">
              ✓
            </span>
          </article>
        ))}
      </div>
    </Card>
  );
}
