'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api';
import { useApiData } from '../shared/use-api-data';

type Stage = {
  id: string;
  name: string;
  position: number;
  color?: string;
  isTerminal: boolean;
  isActive?: boolean;
};
type Pipeline = { id: string; name: string; kind: string; stages: Stage[] };

export function Pipelines({ permissions }: { permissions: readonly string[] }) {
  const pipelines = useApiData<Pipeline[]>('/pipelines');
  const [showForm, setShowForm] = useState(false);
  const [addingTo, setAddingTo] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [busy, setBusy] = useState(false);
  const canManage = permissions.includes('pipelines:manage');

  const perform = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      setFeedback(success);
      pipelines.reload();
      return true;
    } catch (error) {
      setFeedback(`Erro: ${error instanceof ApiError ? error.message : 'operação não concluída'}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    void perform(
      () =>
        api('/pipelines', {
          method: 'POST',
          body: JSON.stringify({
            name: form.get('name'),
            kind: form.get('kind'),
            stages: [
              {
                name: form.get('stageName'),
                position: 0,
                color: form.get('color'),
                isTerminal: false,
              },
            ],
          }),
        }),
      'Pipeline criado.',
    ).then((ok) => {
      if (ok) {
        target.reset();
        setShowForm(false);
      }
    });
  };

  const addStage = (event: FormEvent<HTMLFormElement>, pipeline: Pipeline) => {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    void perform(
      () =>
        api(`/pipelines/${pipeline.id}/stages`, {
          method: 'POST',
          body: JSON.stringify({
            name: form.get('name'),
            position: pipeline.stages.length,
            color: form.get('color'),
            isTerminal: form.get('isTerminal') === 'on',
          }),
        }),
      'Etapa adicionada.',
    ).then((ok) => {
      if (ok) setAddingTo(undefined);
    });
  };

  const updateStage = (pipelineId: string, stage: Stage, changes: Record<string, unknown>) =>
    perform(
      () =>
        api(`/pipelines/${pipelineId}/stages/${stage.id}`, {
          method: 'PATCH',
          body: JSON.stringify(changes),
        }),
      'Etapa atualizada.',
    );

  return (
    <section>
      <header className="page-title">
        <div>
          <p>Administração</p>
          <h1>Pipelines</h1>
          <span>Configure fluxos comerciais, jurídicos e de cobrança.</span>
        </div>
        {canManage && (
          <button className="primary" onClick={() => setShowForm((value) => !value)}>
            {showForm ? 'Fechar' : 'Novo pipeline'}
          </button>
        )}
      </header>
      {feedback && (
        <div
          role="status"
          className={feedback.startsWith('Erro:') ? 'notice notice-error' : 'notice notice-success'}
        >
          {feedback}
        </div>
      )}
      {showForm && canManage && (
        <form className="surface form-grid" onSubmit={create}>
          <label>
            Nome
            <input required minLength={2} name="name" />
          </label>
          <label>
            Tipo
            <select required name="kind" defaultValue="LEGAL">
              <option value="COMMERCIAL">Comercial</option>
              <option value="LEGAL">Jurídico</option>
              <option value="COLLECTION">Cobrança</option>
            </select>
          </label>
          <label>
            Primeira etapa
            <input required minLength={2} name="stageName" placeholder="Entrada" />
          </label>
          <label>
            Cor
            <input required type="color" name="color" defaultValue="#5f766d" />
          </label>
          <button className="primary form-wide" disabled={busy}>
            Criar pipeline
          </button>
        </form>
      )}
      {pipelines.error && (
        <div role="alert" className="notice notice-error">
          {pipelines.error.message}
          <button onClick={pipelines.reload}>Tentar novamente</button>
        </div>
      )}
      {!pipelines.data && !pipelines.error ? (
        <div className="loading" aria-label="Carregando pipelines">
          <i />
          <i />
          <i />
        </div>
      ) : pipelines.data?.length ? (
        <div className="pipeline-list">
          {pipelines.data.map((pipeline) => (
            <article className="surface" key={pipeline.id}>
              <h2>{pipeline.name}</h2>
              <p>{pipeline.kind}</p>
              <ol>
                {[...pipeline.stages]
                  .sort((a, b) => a.position - b.position)
                  .map((stage) => (
                    <li key={stage.id}>
                      <i style={{ backgroundColor: stage.color ?? '#5f766d' }} />
                      {stage.name}
                      {stage.isTerminal && <span className="badge">Final</span>}
                      {canManage && (
                        <button
                          className="table-action"
                          disabled={busy}
                          onClick={() =>
                            void updateStage(pipeline.id, stage, {
                              isActive: stage.isActive === false,
                            })
                          }
                        >
                          {stage.isActive === false ? 'Ativar' : 'Desativar'}
                        </button>
                      )}
                    </li>
                  ))}
              </ol>
              {canManage && (
                <button
                  className="secondary"
                  onClick={() => setAddingTo(addingTo === pipeline.id ? undefined : pipeline.id)}
                >
                  Adicionar etapa
                </button>
              )}
              {addingTo === pipeline.id && (
                <form
                  className="stack-form compact-form"
                  onSubmit={(event) => addStage(event, pipeline)}
                >
                  <label>
                    Nome
                    <input required minLength={2} name="name" />
                  </label>
                  <label>
                    Cor
                    <input required type="color" name="color" defaultValue="#5f766d" />
                  </label>
                  <label className="check">
                    <input type="checkbox" name="isTerminal" /> Etapa final
                  </label>
                  <button className="primary" disabled={busy}>
                    Adicionar
                  </button>
                </form>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">
          <strong>Nenhum pipeline</strong>
          <span>Crie o primeiro fluxo de trabalho.</span>
        </div>
      )}
    </section>
  );
}
