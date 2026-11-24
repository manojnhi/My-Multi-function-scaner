-- Offline-First Local SQLite Database Schema (Mobile & Windows Desktop)

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  relative_path TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  category TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 1,
  local_file_uri TEXT NOT NULL,
  thumbnail_uri TEXT,
  ocr_text TEXT DEFAULT '',
  ocr_language TEXT DEFAULT 'eng+hin',
  ocr_status TEXT NOT NULL DEFAULT 'idle',
  filter_mode TEXT NOT NULL DEFAULT 'color',
  source_device TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents(sha256);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC);

CREATE TABLE IF NOT EXISTS paired_devices (
  id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  pair_code TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  paired_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_queue (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  pair_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  retries INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
