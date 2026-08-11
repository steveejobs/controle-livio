import { Logo } from '@livio/ui';
import { dashboardNavigation } from './dashboard.data';

export function Sidebar() {
  return (
    <aside className="sidebar">
      <Logo />
      <nav aria-label="Navegação da fundação">
        <p className="nav-label">Escritório</p>
        {dashboardNavigation.map((item, index) => (
          <a
            className={index === 0 ? 'nav-item nav-item--active' : 'nav-item'}
            href={item.href}
            key={item.label}
          >
            <span className="nav-icon" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            {item.label}
          </a>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className="avatar" aria-hidden="true">
          AS
        </span>
        <span>
          <strong>Ambiente seguro</strong>
          <small>Acesso por organização</small>
        </span>
      </div>
    </aside>
  );
}
