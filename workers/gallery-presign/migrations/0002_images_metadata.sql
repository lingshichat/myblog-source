-- D1 迁移：图片元数据表
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS images (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  user_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_by_role TEXT NOT NULL DEFAULT 'user' CHECK (created_by_role IN ('user', 'admin')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_images_user_id ON images(user_id);
CREATE INDEX IF NOT EXISTS idx_images_owner_id ON images(owner_id);
CREATE INDEX IF NOT EXISTS idx_images_updated_at ON images(updated_at);
