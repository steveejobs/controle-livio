import { Card } from '@livio/ui';
import { pipelineTemplates } from '@livio/shared';

export function PipelinesOverview() {
  return (
    <Card className="pipelines-card" id="pipelines" data-reveal>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Fluxos configuráveis</p>
          <h2>Três pipelines essenciais</h2>
        </div>
        <p className="section-note">Cada transição preserva autor, data, origem e destino.</p>
      </div>
      <div className="pipeline-grid">
        {pipelineTemplates.map((pipeline, pipelineIndex) => (
          <article
            className="pipeline"
            data-reveal
            data-reveal-order={String(pipelineIndex + 1)}
            key={pipeline.kind}
          >
            <div className="pipeline-title">
              <span>0{pipelineIndex + 1}</span>
              <h3>{pipeline.name}</h3>
            </div>
            <ol>
              {pipeline.stages.map((stage) => (
                <li key={stage.name}>
                  <i style={{ backgroundColor: stage.color }} />
                  {stage.name}
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </Card>
  );
}
