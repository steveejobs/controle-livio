'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import NextImage from 'next/image';
import { ApiError, api } from '../../lib/api';

type SigningDetails = {
  status: 'PENDING' | 'PROCESSING' | 'SIGNED';
  documentTitle: string;
  signerName?: string;
  expiresAt?: string;
  sourceVersion?: number;
  sourceSha256?: string;
  documentUrl?: string;
  signedAt?: string;
};

function localTime(value?: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export function SigningExperience({ token }: { token: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [details, setDetails] = useState<SigningDetails>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [signerName, setSignerName] = useState('');
  const [consent, setConsent] = useState(false);
  const [hasMark, setHasMark] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(undefined);
    void api<SigningDetails>(`/public/signatures/${encodeURIComponent(token)}`)
      .then((result) => {
        setDetails(result);
        if (result.signerName) setSignerName(result.signerName);
      })
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? caught.message : 'Não foi possível abrir este link.'),
      )
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(load, [load]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const previousMark = canvas.width ? canvas.toDataURL() : undefined;
    const bounds = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
    canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
    const context = canvas.getContext('2d');
    if (context) {
      context.scale(ratio, ratio);
      context.lineWidth = 2.4;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = '#173f38';
      if (previousMark && hasMark) {
        const image = new Image();
        image.onload = () => context.drawImage(image, 0, 0, bounds.width, bounds.height);
        image.src = previousMark;
      }
    }
  }, [expanded, details?.status, hasMark]);

  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const context = canvas.getContext('2d');
    if (!context) return;
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (event.type === 'pointerdown') {
      canvas.setPointerCapture(event.pointerId);
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + 0.1, y + 0.1);
      context.stroke();
      setHasMark(true);
    } else if (event.type === 'pointermove' && event.buttons > 0) {
      context.lineTo(x, y);
      context.stroke();
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    setHasMark(false);
  };

  const typeSignature = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !signerName.trim()) return;
    clear();
    context.fillStyle = '#173f38';
    context.font = 'italic 42px Georgia, serif';
    context.fillText(signerName.trim().slice(0, 80), 24, canvas.clientHeight / 2 + 12);
    setHasMark(true);
  };

  const sign = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasMark || !signerName.trim() || !consent) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api<SigningDetails>(
        `/public/signatures/${encodeURIComponent(token)}/sign`,
        {
          method: 'POST',
          body: JSON.stringify({
            signerName: signerName.trim(),
            consent,
            signature: canvas.toDataURL('image/png'),
          }),
        },
      );
      setDetails({ ...details!, ...result });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível concluir a assinatura.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="sign-page">
      <header className="sign-header">
        <a className="sign-brand" href="/" aria-label="Lívio">
          <NextImage src="/icon.svg" alt="" width={30} height={30} priority />
          <span>Lívio</span>
        </a>
        <span>Assinatura de documento</span>
      </header>
      <section className="sign-card" aria-labelledby="sign-title">
        {loading ? (
          <div className="sign-state" role="status">
            Carregando documento…
          </div>
        ) : error && !details ? (
          <div className="sign-state">
            <h1 id="sign-title">Link indisponível</h1>
            <p>{error}</p>
          </div>
        ) : details?.status === 'SIGNED' ? (
          <div className="sign-state sign-complete" role="status">
            <span className="sign-check" aria-hidden="true">
              ✓
            </span>
            <h1 id="sign-title">Assinatura concluída</h1>
            <p>{details.documentTitle}</p>
            <small>Assinatura registrada em {localTime(details.signedAt)}.</small>
            <p>O escritório receberá o documento assinado no sistema.</p>
          </div>
        ) : details?.status === 'PROCESSING' ? (
          <div className="sign-state" role="status">
            <h1 id="sign-title">Finalizando assinatura</h1>
            <p>Estamos juntando o comprovante à versão do documento. Aguarde um instante.</p>
            <button className="secondary" onClick={load}>
              Atualizar status
            </button>
          </div>
        ) : details ? (
          <>
            <div className="sign-intro">
              <p className="eyebrow">Documento para assinatura</p>
              <h1 id="sign-title">{details.documentTitle}</h1>
              <p>
                Confira o arquivo antes de assinar. O link é individual e expira em{' '}
                {localTime(details.expiresAt)}.
              </p>
              <a
                className="secondary sign-open-document"
                href={details.documentUrl}
                target="_blank"
                rel="noreferrer"
              >
                Abrir e conferir PDF <span aria-hidden="true">↗</span>
              </a>
              <small>
                Versão {details.sourceVersion} · arquivo protegido por verificação SHA-256
              </small>
            </div>
            <div className="sign-form">
              <label>
                Nome completo
                <input
                  value={signerName}
                  onChange={(event) => setSignerName(event.target.value)}
                  autoComplete="name"
                  maxLength={200}
                />
              </label>
              <div className={`signature-box${expanded ? ' signature-box-expanded' : ''}`}>
                <div className="signature-heading">
                  <span>Assine no espaço abaixo</span>
                  <button
                    type="button"
                    className="table-action"
                    onClick={() => setExpanded((value) => !value)}
                  >
                    {expanded ? 'Reduzir área' : 'Ampliar área'}
                  </button>
                </div>
                <canvas
                  ref={canvasRef}
                  role="img"
                  aria-label="Área para desenhar a assinatura"
                  onPointerDown={draw}
                  onPointerMove={draw}
                  onPointerUp={(event) =>
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                  onPointerCancel={(event) =>
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                />
                <div className="signature-actions">
                  <button type="button" className="table-action" onClick={clear}>
                    Limpar
                  </button>
                  <button type="button" className="table-action" onClick={typeSignature}>
                    Usar nome digitado
                  </button>
                  {expanded && (
                    <button type="button" className="secondary" onClick={() => setExpanded(false)}>
                      Concluir desenho e continuar
                    </button>
                  )}
                </div>
              </div>
              <label className="sign-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>
                  Confirmo que revisei o documento e concordo em assinar eletronicamente esta
                  versão.
                </span>
              </label>
              {error && (
                <div className="notice notice-error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="primary sign-submit"
                onClick={() => void sign()}
                disabled={busy || !hasMark || !signerName.trim() || !consent}
              >
                {busy ? 'Registrando assinatura…' : 'Assinar documento'}
              </button>
              <small className="sign-privacy">
                A imagem da assinatura e os dados desta versão ficam protegidos no sistema do
                escritório.
              </small>
            </div>
          </>
        ) : null}
      </section>
      <footer className="sign-footer">Lívio · documentos do escritório</footer>
    </main>
  );
}
