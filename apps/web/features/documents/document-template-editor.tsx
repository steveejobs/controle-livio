'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';

type DocumentTemplateCategory = 'CONTRATO_HONORARIOS' | 'PROCURACAO' | 'HIPOSSUFICIENCIA';
type DocumentTemplate = {
  category: DocumentTemplateCategory;
  label: string;
  content: string;
  customized: boolean;
};
type TemplateVariable = {
  token: string;
  label: string;
  description: string;
  example: string;
  categories: DocumentTemplateCategory[];
};
type TemplatesResponse = { templates: DocumentTemplate[]; variables: TemplateVariable[] };

const initialCategory: DocumentTemplateCategory = 'CONTRATO_HONORARIOS';

export function DocumentTemplateEditor() {
  const [data, setData] = useState<TemplatesResponse>();
  const [category, setCategory] = useState<DocumentTemplateCategory>(initialCategory);
  const [content, setContent] = useState('');
  const [feedback, setFeedback] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef({ start: 0, end: 0 });

  useEffect(() => {
    let active = true;
    void api<TemplatesResponse>('/documents/templates')
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(undefined);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof ApiError ? caught.message : 'Não foi possível carregar os modelos.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const currentTemplate = data?.templates.find((template) => template.category === category);
  const hasUnsavedChanges = Boolean(currentTemplate && content !== currentTemplate.content);
  useEffect(() => {
    if (!currentTemplate) return;
    setContent(currentTemplate.content);
  }, [currentTemplate]);

  const variables = useMemo(
    () => data?.variables.filter((variable) => variable.categories.includes(category)) ?? [],
    [category, data],
  );
  const variableGroups = useMemo(
    () =>
      [
        {
          title: 'Cliente',
          variables: variables.filter(({ token }) => token.startsWith('{{cliente.')),
        },
        {
          title: 'Escritório',
          variables: variables.filter(({ token }) => token.startsWith('{{escritorio.')),
        },
        {
          title: 'Contrato e cobrança',
          variables: variables.filter(({ token }) => token.startsWith('{{contrato.')),
        },
        {
          title: 'Documento e assinaturas',
          variables: variables.filter(
            ({ token }) =>
              !token.startsWith('{{cliente.') &&
              !token.startsWith('{{escritorio.') &&
              !token.startsWith('{{contrato.'),
          ),
        },
      ].filter((group) => group.variables.length > 0),
    [variables],
  );
  const preview = useMemo(
    () =>
      content.replace(/\{\{[^{}]+\}\}/g, (token) => {
        const variable = variables.find((item) => item.token === token);
        return variable ? `[${variable.example}]` : `[Variável não reconhecida: ${token}]`;
      }),
    [content, variables],
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFeedback(undefined);
    setError(undefined);
    void api<TemplatesResponse>('/documents/templates', {
      method: 'PATCH',
      body: JSON.stringify({ category, content }),
    })
      .then((result) => {
        setData(result);
        setFeedback('Modelo salvo. As próximas emissões usarão este texto.');
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Não foi possível salvar o modelo. Confira as variáveis obrigatórias.',
        );
      })
      .finally(() => setSaving(false));
  };

  const restoreDefault = () => {
    if (
      hasUnsavedChanges &&
      !window.confirm('Descartar as alterações não salvas e restaurar o modelo padrão?')
    )
      return;
    setSaving(true);
    setFeedback(undefined);
    setError(undefined);
    void api<TemplatesResponse>(`/documents/templates/${category}`, { method: 'DELETE' })
      .then((result) => {
        setData(result);
        setFeedback('Modelo padrão restaurado para as próximas emissões.');
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof ApiError ? caught.message : 'Não foi possível restaurar o modelo.',
        );
      })
      .finally(() => setSaving(false));
  };

  const insertVariable = (variable: TemplateVariable) => {
    const start = selectionRef.current.start;
    const end = selectionRef.current.end;
    const next = `${content.slice(0, start)}${variable.token}${content.slice(end)}`;
    const cursor = start + variable.token.length;
    setContent(next);
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      editor.setSelectionRange(cursor, cursor);
      selectionRef.current = { start: cursor, end: cursor };
    });
  };

  const rememberSelection = (field: HTMLTextAreaElement) => {
    selectionRef.current = { start: field.selectionStart, end: field.selectionEnd };
  };

  return (
    <details className="surface optional-fields document-template-editor">
      <summary>Modelos de documentos editáveis</summary>
      <p className="section-note">
        Personalize o texto de cada documento. As variáveis inserem dados atuais do cadastro;
        mudanças valem para novas emissões e preservam versões já geradas.
      </p>
      {loading ? (
        <div className="loading" role="status" aria-label="Carregando modelos">
          <i />
          <i />
          <i />
        </div>
      ) : error && !data ? (
        <div role="alert" className="notice notice-error">
          {error}
        </div>
      ) : data && currentTemplate ? (
        <form className="stack-form template-editor-form" onSubmit={submit}>
          <div className="template-editor-toolbar">
            <label>
              Documento para editar
              <select
                value={category}
                onChange={(event) => {
                  if (
                    hasUnsavedChanges &&
                    !window.confirm('Descartar as alterações não salvas e abrir outro modelo?')
                  ) {
                    event.currentTarget.value = category;
                    return;
                  }
                  setCategory(event.target.value as DocumentTemplateCategory);
                  setFeedback(undefined);
                  setError(undefined);
                }}
              >
                {data.templates.map((template) => (
                  <option key={template.category} value={template.category}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="template-state" aria-live="polite">
              {hasUnsavedChanges
                ? 'Alterações não salvas'
                : currentTemplate.customized
                  ? 'Modelo personalizado'
                  : 'Usando modelo padrão'}
            </span>
          </div>

          <fieldset className="template-variable-picker">
            <legend>Inserir dados automáticos</legend>
            <p className="section-note">
              Escolha um dado pelo nome e pela explicação. Ele será inserido no ponto selecionado do
              texto e preenchido automaticamente ao emitir o documento.
            </p>
            {variableGroups.map((group) => (
              <section className="template-variable-group" key={group.title}>
                <h3>{group.title}</h3>
                <div className="template-variable-list">
                  {group.variables.map((variable) => (
                    <button
                      key={variable.token}
                      type="button"
                      className="secondary template-variable-button"
                      aria-label={`${variable.label}. ${variable.description}. Inserir no texto.`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insertVariable(variable)}
                    >
                      <span>{variable.label}</span>
                      <small>{variable.description}</small>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </fieldset>

          <label className="template-editor-label">
            Texto do modelo
            <textarea
              ref={editorRef}
              name="editor"
              required
              minLength={100}
              maxLength={40_000}
              rows={22}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              onSelect={(event) => rememberSelection(event.currentTarget)}
              onKeyUp={(event) => rememberSelection(event.currentTarget)}
              onClick={(event) => rememberSelection(event.currentTarget)}
              onBlur={(event) => rememberSelection(event.currentTarget)}
            />
            <small>{content.length.toLocaleString('pt-BR')} de 40.000 caracteres</small>
          </label>

          {previewOpen && (
            <section className="template-preview" aria-label="Prévia do modelo">
              <h3>Prévia com dados de exemplo</h3>
              <pre>{preview}</pre>
            </section>
          )}

          {error && (
            <div role="alert" className="notice notice-error">
              {error}
            </div>
          )}
          {feedback && (
            <div role="status" className="notice notice-success">
              {feedback}
            </div>
          )}

          <div className="template-editor-actions">
            <button
              type="submit"
              className="primary"
              disabled={saving || !hasUnsavedChanges || content.length < 100}
            >
              {saving ? 'Salvando…' : 'Salvar modelo'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setPreviewOpen((open) => !open)}
            >
              {previewOpen ? 'Fechar prévia' : 'Ver prévia'}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={saving || !currentTemplate.customized}
              onClick={restoreDefault}
            >
              Restaurar modelo padrão
            </button>
          </div>
        </form>
      ) : null}
    </details>
  );
}
