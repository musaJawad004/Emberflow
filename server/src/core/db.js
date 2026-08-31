/**
 * SQLite persistence layer (better-sqlite3, WAL mode). Opens/creates the
 * database on import, migrates the schema in place, and exports synchronous
 * CRUD helpers for runs, stages, logs, analyses, and deployments.
 * Default export is the raw db handle (used for shutdown).
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/index.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

migrate();

// Creates missing tables and adds columns that v0 databases lack,
// so an existing emberflow.db upgrades in place without data loss.
function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id          TEXT PRIMARY KEY,
      repo_name   TEXT NOT NULL,
      repo_path   TEXT NOT NULL,
      repo_url    TEXT,
      trigger     TEXT NOT NULL,
      commit_sha  TEXT,
      status      TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      started_at  INTEGER,
      finished_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS stages (
      id          TEXT PRIMARY KEY,
      run_id      TEXT NOT NULL REFERENCES runs(id),
      stage_id    TEXT NOT NULL,
      needs       TEXT NOT NULL,
      command     TEXT NOT NULL,
      image       TEXT NOT NULL,
      status      TEXT NOT NULL,
      exit_code   INTEGER,
      started_at  INTEGER,
      finished_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS logs (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      stage_pk  TEXT NOT NULL REFERENCES stages(id),
      ts        INTEGER NOT NULL,
      stream    TEXT NOT NULL,
      line      TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analyses (
      id         TEXT PRIMARY KEY,
      run_id     TEXT NOT NULL REFERENCES runs(id),
      model      TEXT NOT NULL,
      diagnosis  TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deployments (
      id               TEXT PRIMARY KEY,
      run_id           TEXT NOT NULL REFERENCES runs(id),
      repo_name        TEXT NOT NULL,
      container_name   TEXT NOT NULL,
      image            TEXT NOT NULL,
      start_cmd        TEXT NOT NULL,
      port             INTEGER NOT NULL,
      host_port        INTEGER NOT NULL,
      health_path      TEXT NOT NULL DEFAULT '/',
      status           TEXT NOT NULL,
      rolled_back_from TEXT,
      created_at       INTEGER NOT NULL,
      stopped_at       INTEGER
    );
  `);

  // v0 -> v1: the runs table predates repo_url, so ALTER it in when missing.
  const runColumns = db.prepare('PRAGMA table_info(runs)').all().map((c) => c.name);
  if (!runColumns.includes('repo_url')) {
    db.exec('ALTER TABLE runs ADD COLUMN repo_url TEXT');
  }

  // v1.1: deployments gain health_path (HTTP probe target for deploy verification).
  const deploymentColumns = db.prepare('PRAGMA table_info(deployments)').all().map((c) => c.name);
  if (!deploymentColumns.includes('health_path')) {
    db.exec("ALTER TABLE deployments ADD COLUMN health_path TEXT NOT NULL DEFAULT '/'");
  }
}

// --- runs ---

/** Inserts a run and returns the stored row. */
export function insertRun(run) {
  db.prepare(`
    INSERT INTO runs (id, repo_name, repo_path, repo_url, trigger, commit_sha, status, created_at)
    VALUES (@id, @repo_name, @repo_path, @repo_url, @trigger, @commit_sha, @status, @created_at)
  `).run(run);
  return getRun(run.id);
}

/** Returns the run row for `id`, or undefined. */
export function getRun(id) {
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
}

/** Lists runs newest-first, capped at `limit`. */
export function listRuns(limit = 50) {
  return db.prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT ?').all(limit);
}

/** Partial update: sets only the given fields, returns the fresh row. */
export function updateRun(id, fields) {
  const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE runs SET ${sets} WHERE id = @id`).run({ ...fields, id });
  return getRun(id);
}

// --- stages ---

/** Inserts a stage row (pk `id` is distinct from the emberfile `stage_id`). */
export function insertStage(stage) {
  db.prepare(`
    INSERT INTO stages (id, run_id, stage_id, needs, command, image, status)
    VALUES (@id, @run_id, @stage_id, @needs, @command, @image, @status)
  `).run(stage);
  return getStage(stage.id);
}

/** Returns one stage row by primary key, or undefined. */
export function getStage(pk) {
  return db.prepare('SELECT * FROM stages WHERE id = ?').get(pk);
}

/** All stages of a run in creation order. */
export function getStagesForRun(runId) {
  return db.prepare('SELECT * FROM stages WHERE run_id = ? ORDER BY rowid').all(runId);
}

/** Partial update by primary key; returns the fresh row. */
export function updateStage(pk, fields) {
  const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE stages SET ${sets} WHERE id = @id`).run({ ...fields, id: pk });
  return getStage(pk);
}

// --- logs ---

/** Appends one log line for a stage. */
export function insertLog(stagePk, ts, stream, line) {
  const info = db
    .prepare('INSERT INTO logs (stage_pk, ts, stream, line) VALUES (?, ?, ?, ?)')
    .run(stagePk, ts, stream, line);
  return Number(info.lastInsertRowid);
}

/** Logs for a run (joined with stage_id), oldest first; optional stageId filter. */
export function getLogsForRun(runId, stageId) {
  let sql = `
    SELECT l.*, s.stage_id FROM logs l
    JOIN stages s ON s.id = l.stage_pk
    WHERE s.run_id = ?
  `;
  const params = [runId];
  if (stageId) {
    sql += ' AND s.stage_id = ?';
    params.push(stageId);
  }
  sql += ' ORDER BY l.id';
  return db.prepare(sql).all(...params);
}

// Last N log lines of one stage, in chronological order.
export function getLastLogLines(stagePk, limit) {
  return db.prepare(`
    SELECT * FROM (
      SELECT id, ts, stream, line FROM logs WHERE stage_pk = ? ORDER BY id DESC LIMIT ?
    ) ORDER BY id
  `).all(stagePk, limit);
}

// --- analyses ---

/** Stores an analyst diagnosis and returns the stored row. */
export function insertAnalysis(analysis) {
  db.prepare(`
    INSERT INTO analyses (id, run_id, model, diagnosis, created_at)
    VALUES (@id, @run_id, @model, @diagnosis, @created_at)
  `).run(analysis);
  return db.prepare('SELECT * FROM analyses WHERE id = ?').get(analysis.id);
}

/** Most recent analysis for a run, or undefined. */
export function getAnalysisForRun(runId) {
  return db.prepare('SELECT * FROM analyses WHERE run_id = ? ORDER BY created_at DESC LIMIT 1').get(runId);
}

// --- deployments ---

/** Inserts a deployment and returns the stored row. */
export function insertDeployment(deployment) {
  db.prepare(`
    INSERT INTO deployments (id, run_id, repo_name, container_name, image, start_cmd,
                             port, host_port, health_path, status, rolled_back_from, created_at)
    VALUES (@id, @run_id, @repo_name, @container_name, @image, @start_cmd,
            @port, @host_port, @health_path, @status, @rolled_back_from, @created_at)
  `).run(deployment);
  return getDeployment(deployment.id);
}

/** Returns a deployment by id, or undefined. */
export function getDeployment(id) {
  return db.prepare('SELECT * FROM deployments WHERE id = ?').get(id);
}

/** All deployments, newest first. */
export function listDeployments() {
  return db.prepare('SELECT * FROM deployments ORDER BY created_at DESC, rowid DESC').all();
}

/** Partial update; returns the fresh row. */
export function updateDeployment(id, fields) {
  const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE deployments SET ${sets} WHERE id = @id`).run({ ...fields, id });
  return getDeployment(id);
}

/** The deployment currently in status 'running' for a repo, if any. */
export function getRunningDeployment(repoName) {
  return db.prepare("SELECT * FROM deployments WHERE repo_name = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1").get(repoName);
}

export default db;
