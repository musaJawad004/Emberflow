import YAML from 'yaml';

// Validation problem in the pipeline definition or DAG. `stagePk` (when set)
// ties the error to a specific stage row so a system log line can be attached.
export class PipelineError extends Error {
  constructor(message, stagePk = null) {
    super(message);
    this.stagePk = stagePk;
  }
}

// Parses + validates emberflow.yml text into { name, stages, deploy }.
export function parseEmberfile(text) {
  const doc = YAML.parse(text);
  if (!doc || !Array.isArray(doc.stages) || doc.stages.length === 0) {
    throw new PipelineError('emberflow.yml must define a non-empty "stages" list');
  }

  const seen = new Set();
  const stages = doc.stages.map((stage, i) => {
    if (!stage?.id || typeof stage.run !== 'string') {
      throw new PipelineError(`stage #${i + 1} must have "id" and "run"`);
    }
    if (seen.has(stage.id)) throw new PipelineError(`duplicate stage id "${stage.id}"`);
    seen.add(stage.id);
    const image = stage.image ?? doc.image;
    if (!image) throw new PipelineError(`stage "${stage.id}" has no image (set a pipeline-level "image" or per-stage override)`);
    return { id: stage.id, run: stage.run, needs: stage.needs ?? [], image };
  });

  return { name: doc.name ?? null, stages, deploy: parseDeploy(doc, seen) };
}

function parseDeploy(doc, stageIds) {
  if (!doc.deploy) return null;
  const d = doc.deploy;
  if (typeof d.start !== 'string' || d.start.length === 0) {
    throw new PipelineError('deploy.start must be a command string');
  }
  if (!Number.isInteger(d.port) || !Number.isInteger(d.hostPort)) {
    throw new PipelineError('deploy.port and deploy.hostPort must be integers');
  }
  const needs = d.needs ?? [];
  for (const need of needs) {
    if (!stageIds.has(need)) throw new PipelineError(`deploy needs unknown stage "${need}"`);
  }
  const healthPath = d.healthPath ?? '/';
  if (typeof healthPath !== 'string' || !healthPath.startsWith('/')) {
    throw new PipelineError('deploy.healthPath must be a path starting with "/"');
  }
  const image = d.image ?? doc.image;
  if (!image) throw new PipelineError('deploy has no image (set a pipeline-level "image")');
  return { needs, start: d.start, port: d.port, hostPort: d.hostPort, healthPath, image };
}
