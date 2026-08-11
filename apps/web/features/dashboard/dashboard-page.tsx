import { ModulesOverview } from './modules-overview';
import { PipelinesOverview } from './pipelines-overview';
import { SecurityOverview } from './security-overview';
import { Sidebar } from './sidebar';
import { SystemHealth } from './system-health';
import { WelcomePanel } from './welcome-panel';

export function DashboardPage() {
  return (
    <main className="app-shell">
      <Sidebar />
      <section className="workspace" id="overview">
        <header className="topbar">
          <div>
            <p className="eyebrow">Fundação do sistema</p>
            <h1>Visão operacional</h1>
          </div>
          <SystemHealth />
        </header>
        <WelcomePanel />
        <div className="content-grid">
          <ModulesOverview />
          <SecurityOverview />
        </div>
        <PipelinesOverview />
        <footer className="page-footer" data-reveal>
          <span>Controle Financeiro Lívio</span>
          <span>Precisão financeira com Decimal · PostgreSQL · auditoria imutável</span>
        </footer>
      </section>
    </main>
  );
}
