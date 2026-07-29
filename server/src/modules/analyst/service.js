import { nanoid } from 'nanoid';
import { config } from '../../config/index.js';
import { broadcast } from '../../core/ws.js';
import {
  getRun, getStagesForRun, getLastLogLines,
  insertLog, insertAnalysis,
} from '../../core/db.js';
import { chat } from './groq.js';

const LOG_LINES_PER_STAGE = 80;

// Called when a run finishes as failed (never for canceled runs): collects the
// failed stages' logs, asks Groq for a diagnosis, stores + broadcasts it.
// Missing API key or API/network errors skip gracefully with a system log line.
export async function analyzeRun(runId) {
  const run = getRun(runId);
  if (!run || run.status !== 'failed') return;
  const failedStages = getStagesForRun(runId).filter((s) => s.status === 'failed');
  if (failedStages.length === 0) return;

  // System lines about the analyst attach to the first failed stage.
  const systemLog = (line) => {
    const ts = Date.now();
    insertLog(failedStages[0].id, ts, 'system', line);
    broadcast({ type: 'log', runId, stageId: failedStages[0].stage_id, stream: 'system', line, ts });
  };

  if (!config.groqApiKey) {
    systemLog('analyst skipped: GROQ_API_KEY not set');
    return;
  }

  try {
    const diagnosis = await chat({
      apiKey: config.groqApiKey,
      model: config.groqModel,
      prompt: buildPrompt(failedStages),
    });
    const analysis = insertAnalysis({
      id: nanoid(),
      run_id: runId,
      model: config.groqModel,
      diagnosis: diagnosis.trim(),
      created_at: Date.now(),
    });
    broadcast({ type: 'analysis', runId, analysis });
  } catch (err) {
    systemLog(`analyst skipped: ${err.message}`);
  }
}

function buildPrompt(failedStages) {
  const sections = failedStages.map((stage) => {
    const lines = getLastLogLines(stage.id, LOG_LINES_PER_STAGE)
      .map((l) => `[${l.stream}] ${l.line}`)
      .join('\n');
    return `Stage "${stage.stage_id}" ran \`${stage.command}\` and exited with code ${stage.exit_code}.\n` +
      `Last log lines:\n${lines}`;
  });
  return `A CI pipeline failed. Failed stage details:\n\n${sections.join('\n\n')}`;
}
