-- D1 迁移：邀请码表
CREATE TABLE IF NOT EXISTS invitations (
  code TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (creator_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invitations_creator ON invitations(creator_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);
