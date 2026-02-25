# 泠诗图床 (Gallery) — 技术文档与开发日志

> **项目**：泠诗的存图站 (Gallery & Uploader)
> **技术栈**：Cloudflare Workers + D1 + S3 (缤纷云) + Vue 2.x
> **Worker URL**：`https://gallery-presign.lingshichat.workers.dev`
> **页面 URL**：`https://lingshichat.top/gallery/`
> **D1 数据库**：`gallery_auth` (a0da254a-4cbc-45cd-a01f-b576dc5cee85)

---

## 目录

- [1. 项目概述](#1-项目概述)
- [2. 系统架构](#2-系统架构)
- [3. API 接口文档](#3-api-接口文档)
- [4. 权限与认证体系](#4-权限与认证体系)
- [5. 配置说明](#5-配置说明)
- [6. 数据库结构](#6-数据库结构)
- [7. 开发日志 / 变更记录](#7-开发日志--变更记录)
- [8. 已知问题与待办](#8-已知问题与待办)
- [9. 部署与回滚](#9-部署与回滚)

---

## 1. 项目概述

泠诗图床是为 Hexo 博客（Butterfly 主题）开发的独立图床相册系统，核心功能包括：

### 1.1 核心能力

| 功能模块 | 说明 |
|----------|------|
| **公开图库** | 瀑布流展示、缩略图加载（CoreIX）、Fancybox 灯箱预览 |
| **图片上传** | 拖拽上传、粘贴上传 (Ctrl+V)、悬浮按钮 (FAB)、进度显示 |
| **分类管理** | 多分类目录（全部/二次元/风景/美图/人像）、按分类筛选 |
| **元数据** | 标题、标签、BlurHash 占位图 |
| **权限控制** | 三层 RBAC 权限（public/user/admin）、会话管理 |

### 1.2 设计原则

1. **后端权威鉴权**：权限判断由 Worker 完成，前端仅做 UI 引导
2. **最小写放大**：会话采用固定有效期，不做每请求续期写库
3. **渐进式迁移**：历史数据采用兼容读取 + 渐进归一
4. **安全优先**：先完成鉴权、限流、输入校验、冲突控制，再推进增强功能

---

## 2. 系统架构

### 2.1 文件结构

```
myblog/
├── workers/gallery-presign/
│   ├── worker.js                    # Worker 主入口（预签名 + 元数据 + 认证）
│   ├── package.json                 # 依赖配置
│   ├── wrangler.toml                # 部署配置（staging/production）
│   └── migrations/
│       ├── 0001_auth_init.sql       # 用户与会话表
│       └── 0002_images_metadata.sql # 图片元数据表
│
├── source/gallery/
│   ├── index.html                   # 主页面
│   ├── gallery.css                  # 样式（玻璃拟态）
│   └── gallery.js                   # Vue 2.x 核心逻辑
│
├── _config.yml                      # gallery 已添加到 skip_render
└── _config.butterfly.yml            # 导航菜单配置
```

### 2.2 架构组件

| 组件 | 技术 | 职责 |
|------|------|------|
| **后端 Worker** | Cloudflare Workers | 预签名鉴权、RBAC 校验、元数据 CRUD |
| **数据库** | Cloudflare D1 | 用户、会话、图片元数据存储 |
| **对象存储** | 缤纷云 S3 | 图片文件存储（Source of Truth） |
| **前端** | Vue 2.x (CDN) | UI 交互、瀑布流、灯箱 |

### 2.3 S3 目录结构

```
img/gallery/
├── 二次元/
├── 风景/
├── 美图/
├── 人像/
└── _metadata.json  # [已废弃] 迁移到 D1
```

---

## 3. API 接口文档

### 3.1 统一响应格式

```json
{
  "code": 200,
  "message": "可选的错误或成功消息",
  "data": { "/* 业务数据 */ }
}
```

### 3.2 接口列表

#### 认证接口

| 接口 | 方法 | 鉴权 | 说明 |
|------|------|------|------|
| `/?action=register` | POST | 无 | 用户注册（受 `ALLOW_REGISTRATION` 控制） |
| `/?action=login` | POST | 无 | 用户登录，返回 Bearer Token |
| `/?action=me` | GET | Bearer | 获取当前用户信息 |
| `/?action=logout` | POST | Bearer | 撤销当前会话 |

#### 图片接口

| 接口 | 方法 | 鉴权 | 角色要求 | 说明 |
|------|------|------|----------|------|
| `/?action=list&prefix=&cursor=&limit=` | GET | 可选 | Public | 获取图片列表（支持分页） |
| `/?action=sign` | POST | Bearer | User/Admin | 获取上传预签名 URL |
| `/?action=updateMeta` | POST | Bearer | User(本人)/Admin | 更新图片元数据 |
| `/?action=moveImage` | POST | Bearer | User(本人)/Admin | 移动图片到其他分类 |
| `/?action=deleteImage&key=` | DELETE | Bearer | User(本人)/Admin | 删除图片 |
| `/?action=getMeta&key=` | GET | Bearer | Admin | 获取单张图片元数据 |
| `/?action=signDelete&key=` | GET | Bearer | Admin | 获取删除预签名 URL |

### 3.3 接口详情

#### POST `/?action=register`

**请求体**：
```json
{
  "email": "user@example.com",
  "password": "password123",
  "role": "user"  // 可选，默认 "user"
}
```

**响应**：
- `200`: 注册成功，返回 Token
- `400`: 参数错误（邮箱格式/密码长度）
- `403`: 注册已关闭
- `409`: 邮箱已存在

#### POST `/?action=login`

**请求体**：
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**响应**：
```json
{
  "code": 200,
  "data": {
    "token": "Bearer xxx...",
    "user": {
      "id": 1,
      "email": "user@example.com",
      "role": "user"
    }
  }
}
```

#### GET `/?action=list`

**参数**：
- `prefix`: 目录前缀（如 `img/gallery/二次元/`）
- `cursor`: 分页游标（可选）
- `limit`: 每页数量（默认 50）

**响应**：
```json
{
  "code": 200,
  "data": {
    "images": [
      {
        "key": "img/gallery/二次元/example.jpg",
        "url": "https://...",
        "title": "示例图片",
        "tags": ["二次元", "风景"],
        "userId": "1",
        "createdAt": "2026-02-25T00:00:00Z",
        "version": 1
      }
    ],
    "nextCursor": "eyJrZXkiOi...",
    "hasMore": true
  }
}
```

#### POST `/?action=sign`

**请求体**：
```json
{
  "key": "img/gallery/二次元/example.jpg",
  "contentType": "image/jpeg",
  "contentLength": 1024000
}
```

**响应**：
```json
{
  "code": 200,
  "data": {
    "uploadUrl": "https://s3.bitiful.net/...",
    "headers": {
      "Content-Type": "image/jpeg",
      "Content-Length": "1024000"
    }
  }
}
```

#### POST `/?action=updateMeta`

**请求体**：
```json
{
  "key": "img/gallery/二次元/example.jpg",
  "title": "新标题",
  "tags": ["新标签"],
  "version": 1
}
```

**响应**：
- `200`: 更新成功
- `403`: 无权限（非本人资源）
- `404`: 图片不存在
- `409`: 版本冲突（OCC）

#### POST `/?action=moveImage`

**请求体**：
```json
{
  "sourceKey": "img/gallery/二次元/example.jpg",
  "targetKey": "img/gallery/风景/example.jpg"
}
```

#### DELETE `/?action=deleteImage&key=...`

**参数**：
- `key`: 图片完整路径（URL 编码）

### 3.4 权限矩阵

| 用例ID | 接口 | Public | User | Admin |
|--------|------|--------|------|-------|
| API-01 | `register` | ✅ (受控) | ✅ | ✅ |
| API-02 | `login` | ✅ | ✅ | ✅ |
| API-03 | `me` | ❌ 401 | ✅ | ✅ |
| API-04 | `logout` | ❌ 401 | ✅ | ✅ |
| API-05 | `list` | ✅ 只读 | ✅ | ✅ |
| API-06 | `sign` | ❌ 401 | ✅ | ✅ |
| API-07 | `updateMeta` | ❌ 401 | ✅ 本人 | ✅ |
| API-08 | `moveImage` | ❌ 401 | ✅ 本人 | ✅ |
| API-09 | `deleteImage` | ❌ 401 | ✅ 本人 | ✅ |
| API-10 | `getMeta` | ❌ 401 | ❌ 403 | ✅ |
| API-11 | `signDelete` | ❌ 401 | ❌ 403 | ✅ |

---

## 4. 权限与认证体系

### 4.1 角色定义

| 角色 | 权限范围 |
|------|----------|
| **Public** | 浏览图片、只读访问 |
| **User** | 上传图片、管理本人资源 |
| **Admin** | 上传图片、管理全部资源、调用管理接口 |

### 4.2 会话模型

- 登录成功后签发 Bearer Token
- Token 原文仅返回一次，服务端仅存 `token_hash`
- User 与 Admin 使用不同 TTL（管理员更短）
- 过期或撤销后统一视为未登录

### 4.3 资源归属规则

元数据字段：
- `userId`: 归属用户 ID（主字段）
- `ownerId`: 兼容字段（过渡期保留）
- `createdByRole`: 创建时角色（`user`/`admin`）
- `version`: 元数据版本号（OCC 并发控制）

权限判定：
- `user` 仅当资源归属命中自己 `userId` 时可管理
- `admin` 不受归属限制

### 4.4 前端认证链路

文件：[`source/gallery/gallery.js`](source/gallery/gallery.js)

1. 未登录显示"登录/注册"
2. 登录成功后显示会话角色与退出按钮
3. 刷新后会话可恢复；过期后自动清理并提示重登
4. 401 响应：清理本地会话并打开认证弹窗
5. 429 响应：显示"稍后重试"提示
6. 409 响应：提示冲突并刷新列表

---

## 5. 配置说明

### 5.1 wrangler.toml 环境变量

文件：[`workers/gallery-presign/wrangler.toml`](workers/gallery-presign/wrangler.toml)

```toml
# 非敏感配置（vars）
[vars]
S3_ENDPOINT = "https://s3.bitiful.net"
S3_REGION = "cn-east-1"
S3_BUCKET = "lingshichat"
ALLOW_REGISTRATION = "false"  # 关闭开放注册
CORS_ORIGINS = "https://lingshichat.top,https://www.lingshichat.top"

# 敏感配置（通过 wrangler secret put）
# - SESSION_SECRET: 会话签名密钥
# - S3_ACCESS_KEY: S3 访问密钥
# - S3_SECRET_KEY: S3 私钥
```

### 5.2 前端配置常量

文件：[`source/gallery/gallery.js`](source/gallery/gallery.js)

```javascript
const CONFIG = {
  WORKER_URL: 'https://gallery-presign.lingshichat.workers.dev',
  PAGE_SIZE: 50,
  ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  MAX_FILE_SIZE: 10 * 1024 * 1024  // 10MB
};
```

### 5.3 缤纷云 S3 配置

- **存储桶**：`lingshichat`
- **Endpoint**：`https://s3.bitiful.net`
- **Region**：`cn-east-1`

---

## 6. 数据库结构

### 6.1 D1 迁移文件

| 文件 | 说明 |
|------|------|
| [`migrations/0001_auth_init.sql`](workers/gallery-presign/migrations/0001_auth_init.sql) | 用户表 + 会话表 |
| [`migrations/0002_images_metadata.sql`](workers/gallery-presign/migrations/0002_images_metadata.sql) | 图片元数据表 |

### 6.2 表结构

#### `users` 表

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'admin'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### `sessions` 表

```sql
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

#### `images` 表

```sql
CREATE TABLE images (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',  -- JSON array
  user_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,           -- 兼容字段
  created_by_role TEXT NOT NULL DEFAULT 'user',
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_images_user_id ON images(user_id);
CREATE INDEX idx_images_owner_id ON images(owner_id);
```

---

## 7. 开发日志 / 变更记录

### 2026-02-25 缩略图修复 / 邀请码注册 / 管理员面板 / 自定义域名

**缩略图模糊修复**：
- 根因：浏览器原生 `loading="lazy"` 与自定义 `IntersectionObserver` 双重懒加载冲突，`.is-loaded` 类始终未触发
- 修复：移除原生 lazy 属性，`src` 改为 1px 透明占位 GIF，完全由 JS 控制加载时机
- 文件：`index.html`（移除 `loading="lazy"`）、`gallery.js`（新增 `lazyPlaceholder` + 简化 `onLazyImageLoad`）

**"我的"标签图片归属修复**：
- 根因：`sign` action 不写 D1 元数据 → 无 `userId` → `extractUserIdFromKey` 回退到 `ADMIN_OWNER_ID` → 与用户真实 `usr_xxx` ID 不匹配
- 修复：`sign` 成功后自动 upsert D1 元数据绑定上传者 `userId`；`mine` 过滤逻辑兼容 admin 查看 `ADMIN_OWNER_ID` 归属图片

**邀请码注册机制**：
- D1 新增 `invitations` 表（`0003_invitations.sql`）
- `register` action 改为邀请码验证模式（管理员可免码）
- 注册成功后自动消耗邀请码使用次数
- 前端注册弹窗新增邀请码输入框

**管理员控制中心**：
- Worker 新增 5 个 admin API：`adminListUsers`、`adminUpdateUser`、`adminListInvites`、`adminCreateInvite`、`adminUpdateInvite`
- 前端新增管理员面板弹窗（导航栏 🛡️ 按钮触发），包含「用户管理」和「邀请码管理」两个 Tab
- 用户管理：角色切换（user↔admin）、禁用/启用，禁止修改自己
- 邀请码管理：生成、复制、禁用/启用，显示使用次数

**Worker 自定义域名**：
- `wrangler.toml` 添加 `routes`：`api-gallery.lingshichat.top/*`
- `gallery.js` 的 `WORKER_URL` 切换到自定义域名
- Cloudflare DNS 需添加 `AAAA api-gallery → 100::` 代理记录

### 2026-02-25 安全加固与性能优化

| 优先级 | 修复项 | 说明 |
|--------|--------|------|
| **P0** | 中文路径签名编码 | 上传/删除签名统一使用 UTF-8 编码的 S3 key，修复中文文件名 403 错误 |
| **P1** | 删除后门密码 | 移除 `resolveSession` 中的硬编码管理员密码兼容逻辑 |
| **P1** | 关闭开放注册 | 新增 `ALLOW_REGISTRATION` 环境变量（默认 `false`），注册接口受控 |
| **P2** | CORS 白名单 | `CORS_ORIGINS` 环境变量控制允许域名，替代 `*` 通配符 |
| **P2** | Content-Length 绑定 | 预签名 URL 绑定文件大小，防止签名滥用上传超大文件 |
| **P2** | 真分页滚动加载 | 前端从一次性加载改为 cursor 分页 + IntersectionObserver 无限滚动 |
| **P2** | 批量上传元数据修复 | 每个文件独立构建元数据对象，避免多文件共用同一引用 |
| **P3** | 元数据迁移到 D1 | 从 `_metadata.json` 文件迁移到 D1 `images` 表，支持 OCC 版本控制 |

**关键代码变更**：
- [`workers/gallery-presign/worker.js`](workers/gallery-presign/worker.js): 签名编码修复、后门移除、CORS 白名单、Content-Length 绑定
- [`source/gallery/gallery.js`](source/gallery/gallery.js): 分页滚动、批量上传修复

### 2026-02-23 RBAC 权限体系上线

**完成项**：
1. D1 `users/sessions` 表已接入（已创建 `gallery_auth` 数据库并绑定）
2. 认证接口上线（`register/login/me/logout`）
3. 写接口统一 session 鉴权
4. 前端统一认证入口与会话恢复
5. 修复前端旧版 Token 残留导致的"假登录"问题（启动时 `/me` 静默校验）

**验收结论**：
- Public 调用写接口被拒绝（且前端不再误显上传 FAB）
- User 只能管理自己的资源
- Admin 可管理全量资源

### 2026-02-23 项目初始化

**技术选型**：
- 后端：Cloudflare Worker（原生 AWS Signature V4，无 SDK 依赖，体积 14KB）
- 前端：Vue 2.x (CDN) + 玻璃拟态 UI + Fancybox 灯箱
- 存储：缤纷云 S3

**基础功能**：
- 图片瀑布流展示
- 全局拖拽/粘贴上传
- 分类管理（二次元/风景/美图/人像）
- 元数据存储（初始使用 `_metadata.json`）

---

## 8. 已知问题与待办

### 8.1 待完成 (Todo)

1. **安全基线补强**
   - 强化异常日志维度，重点观察 401/403/409/429

2. **鉴赏体验增强**
   - 标题/标签搜索
   - 标签云筛选
   - 批量操作（仅 admin）
   - BlurHash 占位优化（前端解码）

3. **数据迁移收口**
   - 对历史边界数据做专项回归，降低脏数据残留

### 8.2 已知限制

- 图片大小限制：10MB
- 支持格式：JPEG、PNG、WebP、GIF
- 会话不续期：固定有效期，过期需重新登录

---

## 9. 部署与回滚

### 9.1 发布流程

```bash
# 1. 本地静态检查
node --check workers/gallery-presign/worker.js
node --check source/gallery/gallery.js

# 2. 发布到 production
cd workers/gallery-presign && npm run deploy

# 3. 观察日志
npm run tail
```

### 9.2 回滚预案

**触发条件**（任一满足即回滚）：
- 持续 5xx 峰值
- 鉴权异常导致写接口大面积失败
- 元数据冲突异常上升并影响主流程

**回滚步骤**：
1. 回滚 Worker 到上一稳定版本
2. 暂停前端相关发布，保证只读链路可用
3. 导出故障窗口日志，在本地复现并修复
4. 修复后重新走发布流程，不直接热修 production

---

## 附录：关键文件索引

| 文件 | 说明 |
|------|------|
| [`workers/gallery-presign/worker.js`](workers/gallery-presign/worker.js) | Worker 主入口 |
| [`workers/gallery-presign/wrangler.toml`](workers/gallery-presign/wrangler.toml) | 部署配置 |
| [`workers/gallery-presign/migrations/0001_auth_init.sql`](workers/gallery-presign/migrations/0001_auth_init.sql) | 用户与会话表迁移 |
| [`workers/gallery-presign/migrations/0002_images_metadata.sql`](workers/gallery-presign/migrations/0002_images_metadata.sql) | 图片元数据表迁移 |
| [`workers/gallery-presign/migrations/0003_invitations.sql`](workers/gallery-presign/migrations/0003_invitations.sql) | 邀请码表迁移 |
| [`source/gallery/gallery.js`](source/gallery/gallery.js) | 前端核心逻辑 |
| [`source/gallery/gallery.css`](source/gallery/gallery.css) | 前端样式 |
| [`source/gallery/index.html`](source/gallery/index.html) | 前端页面 |

---

*文档最后更新：2026-02-25 22:48*
