CREATE TABLE IF NOT EXISTS mobile_drafts (
    user_id TEXT PRIMARY KEY,
    draft_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
