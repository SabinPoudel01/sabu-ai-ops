CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL,
  expires_at TEXT NOT NULL, FOREIGN KEY(admin_id) REFERENCES admins(id)
);
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, first_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
  repo TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
  auto_call INTEGER NOT NULL DEFAULT 0,
  last_status TEXT NOT NULL DEFAULT 'unknown', last_code INTEGER,
  last_checked TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY, project_id TEXT, source TEXT NOT NULL DEFAULT 'health',
  severity TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', detected_at TEXT NOT NULL,
  resolved_at TEXT, fingerprint TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status,detected_at);
CREATE TABLE IF NOT EXISTS provider_accounts (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, service TEXT NOT NULL, kind TEXT NOT NULL,
  plan TEXT NOT NULL CHECK(plan IN ('free','trial','paid')),
  priority INTEGER NOT NULL DEFAULT 50, enabled INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'ready', free_verified INTEGER NOT NULL DEFAULT 0,
  quota_units REAL, used_units REAL NOT NULL DEFAULT 0,
  quota_reset_at TEXT, config_json TEXT NOT NULL DEFAULT '{}',
  credentials_cipher TEXT NOT NULL, created_at TEXT NOT NULL,
  last_error TEXT, last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_providers ON provider_accounts(kind,enabled,state,priority);
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY, incident_id TEXT NOT NULL,
  provider_id TEXT NOT NULL, external_id TEXT, state TEXT NOT NULL DEFAULT 'requested',
  destination_tail TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
  seconds INTEGER NOT NULL DEFAULT 0, turns INTEGER NOT NULL DEFAULT 0, transcript TEXT NOT NULL DEFAULT '',
  decision TEXT, FOREIGN KEY(incident_id) REFERENCES incidents(id)
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, incident_id TEXT NOT NULL,
  requested_action TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, approved_at TEXT
);
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
