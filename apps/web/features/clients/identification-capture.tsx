'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type Tesseract from 'tesseract.js';
import { MAX_DOCUMENT_UPLOAD_SIZE_MB } from '@livio/shared';
import { getDocumentUploadSizeError } from '../shared/document-upload-limit';
import { parseIdentificationText, type IdentificationData } from './identification-reader';

export function IdentificationCapture({
  onImageSelected,
  onUseData,
}: {
  onImageSelected: (file?: File) => void;
  onUseData: (data: IdentificationData, file: File) => boolean;
}) {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [fields, setFields] = useState<IdentificationData>();
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [usedData, setUsedData] = useState(false);
  const [progress, setProgress] = useState('');
  const [feedback, setFeedback] = useState<string>();
  const reader = useRef<Tesseract.Worker | undefined>(undefined);
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
      void reader.current?.terminate().catch(() => undefined);
      reader.current = undefined;
    },
    [],
  );

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!selected || busy) return;
    if (
      !['image/jpeg', 'image/png'].includes(selected.type) ||
      getDocumentUploadSizeError(selected.size)
    ) {
      setFeedback(`Escolha uma imagem JPG ou PNG de até ${MAX_DOCUMENT_UPLOAD_SIZE_MB} MiB.`);
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
    if (!file || busy) return;
    const currentGeneration = ++generation.current;
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
        errorHandler: () => {
          /* recognize rejects and the catch below presents the error */
        },
        logger: (event) => {
          if (generation.current !== currentGeneration) return;
          const label =
            event.status === 'recognizing text' ? 'Lendo o documento' : 'Carregando leitor';
          setProgress(`${label}: ${Math.round((event.progress ?? 0) * 100)}%`);
        },
      });
      if (generation.current !== currentGeneration) {
        await worker.terminate();
        return;
      }
      reader.current = worker;
      const result = await worker.recognize(file);
      if (generation.current !== currentGeneration) return;
      const extracted = parseIdentificationText(result.data.text);
      if (!Object.keys(extracted).length) {
        setFeedback(
          'Não encontrei nome, CPF ou RG legíveis. Tente outra foto, mais nítida e bem iluminada.',
        );
        setFields(undefined);
      } else {
        setFields(extracted);
        setFeedback(
          'Confira os dados encontrados e corrija o que precisar antes de usar.' +
            (/\bCPF\b/i.test(result.data.text) && !extracted.cpf
              ? ' O CPF não foi validado; confira o documento e preencha manualmente se necessário.'
              : ''),
        );
      }
    } catch {
      if (generation.current === currentGeneration)
        setFeedback('Não foi possível ler a imagem. Confira a conexão e tente novamente.');
    } finally {
      await worker?.terminate().catch(() => undefined);
      if (reader.current === worker) reader.current = undefined;
      if (generation.current === currentGeneration) {
        setBusy(false);
        setProgress('');
      }
    }
  };

  const updateField = (key: keyof IdentificationData, value: string) => {
    setFields((current) => (current ? { ...current, [key]: value } : current));
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
            disabled={busy}
            onChange={chooseFile}
            aria-label="Escolher foto do documento"
          />
        </label>
        <label className="secondary compact-action identification-file-control">
          Tirar foto
          <input
            type="file"
            accept="image/jpeg,image/png"
            disabled={busy}
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
        {file && (
          <button
            className="secondary"
            type="button"
            onClick={() => {
              generation.current += 1;
              void reader.current?.terminate().catch(() => undefined);
              reader.current = undefined;
              setBusy(false);
              setProgress('');
              setFile(undefined);
              setPreview(undefined);
              setFields(undefined);
              setApplied(false);
              setFeedback(undefined);
              onImageSelected(undefined);
            }}
          >
            Descartar imagem e leitura
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
            {usedData
              ? 'Dados aplicados ao cadastro. Confira ou ajuste os campos antes de concluir.'
              : 'Valores atuais preservados. Nenhum dado foi substituído; a imagem continua selecionada para anexar.'}
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
              setUsedData(onUseData(fields, file));
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
