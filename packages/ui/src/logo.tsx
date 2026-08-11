export interface LogoProps {
  compact?: boolean;
}

export function Logo({ compact = false }: LogoProps) {
  return (
    <div className="ui-logo" aria-label="Controle Financeiro Lívio">
      <span className="ui-logo__mark" aria-hidden="true">
        L
      </span>
      {!compact && (
        <span className="ui-logo__name">
          Lívio <small>Controle Financeiro</small>
        </span>
      )}
    </div>
  );
}
