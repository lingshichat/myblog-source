# 图床元数据 D1 迁移与前端优化计划

## 1. 数据库结构更新 (D1)

创建新的迁移文件 `workers/gallery-presign/migrations/0002_images_metadata.sql`：

```sql
CREATE TABLE IF NOT EXISTS images (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]', -- JSON array
  user_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_by_role TEXT NOT NULL DEFAULT 'user',
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_images_user_id ON images(user_id);
CREATE INDEX IF NOT EXISTS idx_images_owner_id ON images(owner_id);
```

## 2. Worker 后端改造 (`worker.js`)

### 2.1 移除 S3 元数据读写
- 移除 `getMetadata` 和 `saveMetadata` 函数。
- 移除对 `_metadata.json` 的依赖。

### 2.2 改造 `list` 接口
- 保持从 S3 获取文件列表（S3 仍是文件的 Source of Truth）。
- 提取当前页 S3 文件的 `key` 列表。
- 使用 `SELECT * FROM images WHERE key IN (...)` 从 D1 批量获取元数据。
- 组装返回数据。移除原有的 `lazy normalize` 逻辑。

### 2.3 改造元数据操作接口
- `updateMeta`: 改为 D1 的 `INSERT ... ON CONFLICT(key) DO UPDATE ...` 或先查后更新。处理版本冲突（乐观锁）。
- `deleteMeta`: 改为 `DELETE FROM images WHERE key = ?`。
- `moveImage`: 在 D1 中更新记录的 `key`（由于 `key` 是主键，可能需要 `INSERT` 新记录并 `DELETE` 旧记录，或者如果 SQLite 支持直接 `UPDATE key` 则直接更新）。
- `deleteImage`: 删除 S3 文件后，同步执行 `DELETE FROM images WHERE key = ?`。

### 2.4 数据迁移接口 (临时)
- 添加一个仅管理员可访问的临时接口 `?action=migrateMetadata`。
- 该接口读取 S3 的 `_metadata.json`，解析后批量插入到 D1 的 `images` 表中。
- 迁移完成后可删除此接口或保留备用。

## 3. 前端 P2 问题修复 (`gallery.js`)

### 3.1 真分页滚动加载
- 修改 `GalleryService.listImages`，移除 `while` 循环，使其仅请求单页数据，并返回 `{ images, nextCursor, hasMore }`。
- 在 Vue 实例中增加 `nextCursor`, `hasMore`, `loadingMore` 状态。
- 修改 `loadImages` 支持追加模式 (`append = true`)。
- 引入 `IntersectionObserver` 监听列表底部元素，触发加载下一页。

### 3.2 批量上传元数据复用修复
- 在 `startUpload` 的循环中，动态生成标题。
- 如果 `uploadFiles.length > 1` 且用户填写了 `uploadTitle`，则为每个文件追加序号，例如 `${uploadTitle}-${i + 1}`。

## 4. 实施步骤

1. **[Code 模式]** 编写 SQL 迁移文件并应用到本地/线上 D1。
2. **[Code 模式]** 修改 `worker.js` 实现 D1 元数据读写和迁移接口。
3. **[Code 模式]** 部署 Worker，调用迁移接口完成历史数据迁移。
4. **[Code 模式]** 修改 `gallery.js` 修复分页和批量上传问题。
5. **[Orchestrator 模式]** 验证所有功能。