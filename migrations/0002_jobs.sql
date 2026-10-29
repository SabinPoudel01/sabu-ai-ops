CREATE TABLE IF NOT EXISTS execution_jobs (
  id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, action TEXT NOT NULL,
  approval_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL DEFAULT 'queued',
  result TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, finished_at TEXT
);
