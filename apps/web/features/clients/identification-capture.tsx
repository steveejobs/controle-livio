'use client';

import Image from 'next/image';
import { useEffect, useState, type ChangeEvent } from 'react';
import type Tesseract from 'tesseract.js';
import { parseIdentificationText, type IdentificationData } from './identification-reader';

const maximumImageSize = 8 * 1024 * 1024;

export function IdentificationCapture({
  onImageSelected,
  onUseData,
}: {
  onImageSelected: (file: File) => void;
  onUseData: (data: IdentificationData, file: File) => void;
}) {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [fields, setFields] = useState<IdentificationData>();
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [progress, setProgress] = useState('');
  const [feedback, setFeedback] = useState<string>();

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!selected) return;
    if (!['image/jpeg', 'image/png'].includes(selected.type) || selected.size > maximumImageSize) {
      setFeedback('Escolha uma imagem JPG ou PNG de até 8 MB.');
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    setFields(undefined);
    setApplied(false);
    setFeedback(undefined);
    setProgress('');
    onImageSelected(selected);
  };

  const readDocument = async () => {
    if (!file) return;
    setBusy(true);
    setApplied(false);
    setFeedback(undefined);
    setProgress('Preparando leitura…');
    let worker: Tesseract.Worker | undefined;
    try {
      const { createWorker } = await import('tesseract.js');
      worker = await createWorker('por', 1, {
        workerPath: '/ocr/worker.min.js',
        langPath: '/ocr',
        corePath: '/ocr/tesseract-core.wasm.js',
        logger: (event) => {
          const label =
            event.status === 'recognizing text' ? 'Lendo o documento' : 'Carregando leitor';
          setProgress(`${label}: ${Math.round((event.progress ?? 0) * 100)}%`);
        },
      });
      const result = await worker.recognize(file);
      const extracted = parseIdentificationText(result.data.text);
      if (!Object.keys(extracted).length) {
        setFeedback(
          'Não encontrei nome, CPF ou RG legíveis. Tente outra foto, mais nítida e bem iluminada.',
        );
        setFields(undefined);
      } else {
        setFields(extracted);
        setFeedback('Confira os dados encontrados e corrija o que precisar antes de usar.');
      }
    } catch {
      setFeedback('Não foi possível ler a imagem. Confira a conexão e tente novamente.');
    } finally {
      await worker?.terminate().catch(() => undefined);
      setBusy(false);
      setProgress('');
    }
  };

  const updateField = (key: keyof IdentificationData, value: string) => {
    setFields((current) => (current ? { ...current, [key]: value || undefined } : current));
  };

  return (
    <fieldset className="form-wide identification-capture">
      <legend>Documento de identificação</legend>
      <p className="section-note">
        Escolha uma imagem ou tire a foto. A leitura acontece neste navegador; confira os dados
        antes de usar. A imagem será anexada à ficha quando o cadastro for concluído.
      </p>
      <div className="identification-capture-actions">
        <label className="secondary compact-action identification-file-control">
          Escolher foto
          <input
            type="file"
            accept="image/jpeg,image/png"
            onChange={chooseFile}
            aria-label="Escolher foto do documento"
          />
        </label>
        <label className="secondary compact-action identification-file-control">
          Tirar foto
          <input
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            onChange={chooseFile}
            aria-label="Tirar foto do documento"
          />
        </label>
        {file && (
          <button className="primary" type="button" disabled={busy} onClick={readDocument}>
            {busy ? 'Lendo documento…' : 'Ler dados do documento'}
          </button>
        )}
        {file && !fields && (
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => onUseData({}, file)}
          >
            Anexar imagem ao cadastro
          </button>
        )}
      </div>
      {preview && (
        <div className="identification-preview">
          <Image
            src={preview}
            alt="Prévia do documento selecionado"
            width={440}
            height={280}
            unoptimized
          />
          <span>{file?.name}</span>
        </div>
      )}
      {progress && (
        <p className="section-note" role="status" aria-live="polite">
          {progress}
        </p>
      )}
      {feedback && (
        <p className="section-note" role={fields ? 'status' : 'alert'}>
          {feedback}
        </p>
      )}
      {fields && applied && (
        <div className="identification-review">
          <p className="section-note" role="status">
            Dados aplicados ao cadastro. Confira ou ajuste os campos antes de concluir.
          </p>
          <button className="secondary" type="button" onClick={() => setApplied(false)}>
            Rever dados extraídos
          </button>
        </div>
      )}
      {fields && !applied && (
        <div className="form-grid identification-review">
          {fields.name !== undefined && (
            <label>
              Nome encontrado
              <input
                value={fields.name}
                onChange={(event) => updateField('name', event.target.value)}
                maxLength={200}
              />
            </label>
          )}
          {fields.cpf !== undefined && (
            <label>
              CPF encontrado
              <input
                value={fields.cpf}
                onChange={(event) =>
                  updateField('cpf', event.target.value.replace(/\D/g, '').slice(0, 11))
                }
                inputMode="numeric"
              />
            </label>
          )}
          {fields.rg !== undefined && (
            <label>
              RG encontrado
              <input
                value={fields.rg}
                onChange={(event) => updateField('rg', event.target.value)}
                maxLength={60}
              />
            </label>
          )}
          {fields.issuingAuthority !== undefined && (
            <label>
              Órgão expedidor
              <input
                value={fields.issuingAuthority}
                onChange={(event) => updateField('issuingAuthority', event.target.value)}
                maxLength={40}
              />
            </label>
          )}
          {fields.birthDate !== undefined && (
            <label>
              Data de nascimento
              <input
                type="date"
                value={fields.birthDate}
                onChange={(event) => updateField('birthDate', event.target.value)}
              />
            </label>
          )}
          <button
            className="secondary form-wide"
            type="button"
            onClick={() => {
              if (!file) return;
              onUseData(fields, file);
              setApplied(true);
            }}
          >
            Usar dados no cadastro
          </button>
        </div>
      )}
    </fieldset>
  );
}
