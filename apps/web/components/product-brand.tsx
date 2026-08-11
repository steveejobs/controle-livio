type ProductBrandProps = {
  compact?: boolean;
  inverse?: boolean;
};

export function ProductBrand({ compact = false, inverse = false }: ProductBrandProps) {
  return (
    <div
      className={`product-brand${compact ? ' product-brand--compact' : ''}${inverse ? ' product-brand--inverse' : ''}`}
      aria-label="Controle Financeiro Lívio"
    >
      <span className="product-brand__mark" aria-hidden="true">
        L
      </span>
      <span className="product-brand__copy">
        <strong>Lívio</strong>
        <small>{compact ? 'Financeiro' : 'Controle Financeiro'}</small>
      </span>
    </div>
  );
}
