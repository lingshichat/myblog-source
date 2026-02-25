# 图床权限与会话演进方案（D1 账号体系）

> 适用项目：泠诗图床（Gallery & Uploader）
>
> 目标：以低维护成本实现 `public / user / admin` 三层权限，并完成从旧口令模式到邮箱账号+会话模式的迁移。

---

## 1. 产品定位与边界

图床定位为：

- 公开端（public）：只读浏览
- 用户端（user）：登录后可上传与管理本人资源
- 管理端（admin）：可管理全部资源

核心原则：

1. 账号与会话走 D1，图片与图片元数据继续走 S3
2. 权限判定在 Worker 后端完成，前端仅做可见性引导
3. 会话固定有效期，不做心跳续期、不做每请求续期写库
4. 优先保证安全基线，再扩展体验能力

---

## 2. 权限模型

### 2.1 角色定义

- Public（公众）
  - 可浏览图片
  - 不可调用写接口

- User（登录用户）
  - 可上传图片
  - 可编辑/移动/删除自己上传的图片
  - 不可修改他人图片

- Admin（管理员）
  - 可上传图片
  - 可编辑/移动/删除任意图片
  - 可调用管理型接口（如 `getMeta` / `signDelete`）

### 2.2 资源归属规则

每张图片元数据统一使用：

- `userId`：归属用户 ID（新字段）
- `ownerId`：兼容字段（过渡期保留）
- `createdByRole`：创建时角色（`user`/`admin`）
- `createdAt`、`updatedAt`
- `version`：元数据版本号（并发控制）

权限判定：

- `user` 仅当资源归属命中自己 `userId` 时可管理
- `admin` 不受归属限制

### 2.3 会话模型

- 登录成功后签发 Bearer Token
- Token 原文仅返回一次，服务端仅存 `token_hash`
- `user` 与 `admin` 使用不同 TTL（管理员更短）
- 过期或撤销后统一视为未登录

---

## 3. 当前实现状态（与代码一致）

后端：`workers/gallery-presign/worker.js`

- 已实现账号接口：`register`、`login`、`me`、`logout`
- 写接口统一鉴权：`sign`、`updateMeta`、`moveImage`、`deleteImage`
- 归属兼容迁移：读取时可兼容 `ownerId -> userId`
- 限流与输入校验：`sign` 频率限制、邮箱格式与密码长度校验、上传输入校验

前端：`source/gallery/gallery.js` + `source/gallery/index.html`

- 已移除旧“访客/管理员口令分叉”
- 已改为登录/注册一体弹窗
- 已修复权限显隐：
  - 未登录隐藏上传入口
  - 仅 `user/admin` 可上传
  - 管理按钮按角色/归属显示

---

## 4. 已做 / 待做 / 设计理念 / 产品体验

### 4.1 已做（Done）

1. 账号与会话体系已切换到 D1
   - 已落地 `users/sessions` 表与会话校验链路
   - 登录后仅返回一次明文 Token，服务端仅存 `token_hash`
2. 认证接口已完成并可联调
   - `register` / `login` / `me` / `logout`
3. 写接口已统一 RBAC 校验
   - `sign` / `updateMeta` / `moveImage` / `deleteImage`
4. 前端认证体验已统一
   - 移除旧“访客/管理员口令分叉”
   - 改为登录/注册一体弹窗
   - 会话恢复、过期清理、401 重登引导已接入
5. 资源归属兼容迁移已进入可用状态
   - 读取链路可兼容 `ownerId -> userId`
   - 新写入链路以 `userId` 为准

### 4.2 待做（Todo）

1. 在 staging 完成全量回归并修复问题
   - 覆盖第 7 章 API-01~API-11 与前端关键链路
2. 完成 `ownerId -> userId` 迁移收口
   - 对历史边界数据做专项回归，降低脏数据残留
3. 安全基线补强与观测完善
   - 强化异常日志维度，重点观察 401/403/409/429
4. 生产切换与发布后观察
   - 通过灰度 Go 条件后发布 production
   - 观察 30~60 分钟，异常即按回滚预案执行

### 4.3 设计理念

1. 后端权威鉴权（Backend as Policy Source）
   - 权限判断必须由 Worker 完成，前端仅做 UI 引导，避免“前端绕过”风险。
2. 最小写放大（Min-Write Session）
   - 会话采用固定有效期，不做每请求续期写库，优先控制成本与复杂度。
3. 渐进式迁移（Progressive Migration）
   - 对历史 `ownerId` 数据采用兼容读取 + 渐进归一，避免一次性迁移带来的高风险。
4. 安全优先于体验扩展
   - 先完成鉴权、限流、输入校验、冲突控制，再推进搜索/批量等增强功能。

### 4.4 产品体验（UX）

1. 低认知负担的登录体验
   - 统一登录/注册入口，减少角色分叉导致的理解成本。
2. 可预期的权限反馈
   - 未登录直接隐藏上传入口；越权操作返回明确错误并提示重登/重试。
3. 连续的上传与管理闭环
   - 上传（签名 -> S3）成功后即时刷新列表；编辑/移动/删除均有清晰结果反馈。
4. 面向稳定性的异常体验
   - 401 自动清会话并引导认证；429 给出稍后重试提示；409 引导刷新处理冲突。

---

## 5. 分阶段计划（更新版）

## P0 权限重构与安全基线（已落地）

### 结果

- D1 `users/sessions` 已接入（已创建 `gallery_auth` 数据库并绑定到生产环境）
- 认证接口已上线（`register/login/me/logout`）
- 写接口已统一 session 鉴权
- 前端统一认证入口与会话恢复已完成
- 修复了前端旧版 Token 残留导致的“假登录”问题（增加了启动时 `/me` 静默校验）
- 确认了当前仅个人开发，暂不创建 staging 环境，直接在线上验证

### 验收结论

- Public 调用写接口被拒绝（且前端不再误显上传 FAB）
- User 只能管理自己的资源
- Admin 可管理全量资源

---

## P1 数据一致性与性能（进行中）

### 重点

1. `list` 分页与游标链路持续验证
2. `updateMeta` 版本冲突流程回归
3. `moveImage` 异常补偿与一致性验证

---

## P2 鉴赏体验增强（规划中）

1. 标题/标签搜索
2. 标签云筛选
3. 批量操作（仅 admin）
4. BlurHash 占位优化

---

## 6. 老数据迁移策略（ownerId -> userId）

迁移原则：

- 不做一次性全量离线迁移
- 在读取链路进行 lazy normalize
- 写回时补全标准字段，统一到 `userId`

兼容规则：

- 若仅有 `ownerId`，则在读取后映射为 `userId`
- 若两者都缺失，则按历史策略落到 admin 归属并记录迁移日志

---

## 7. 接口基线（当前 Worker 语义）

统一返回结构：`{ code, message?, data?, ... }`

- `GET /?action=list`
- `POST /?action=register`
- `POST /?action=login`
- `GET /?action=me`
- `POST /?action=logout`
- `POST /?action=sign`
- `POST /?action=updateMeta`
- `POST /?action=moveImage`
- `DELETE /?action=deleteImage&key=...`
- `GET /?action=getMeta`（admin）
- `GET /?action=signDelete&key=...`（admin）

---

## 8. RBAC 回归清单（接口级 + 前端链路）

### 7.1 测试准备

- Secret 已配置：`SESSION_SECRET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`
- 若需初始化 admin：确认 D1 中存在 `role=admin` 的用户
- 前端页面：`source/gallery/index.html`
- Worker 入口：`workers/gallery-presign/worker.js`

### 7.2 接口权限矩阵

| 用例ID | 接口 | Public(无 Token) | User Token | Admin Token | 断言重点 |
|---|---|---:|---:|---:|---|
| API-01 | `POST /?action=register` | 200/400/409 | 200/400/409 | 200/400/409 | 邮箱合法、重复邮箱 409 |
| API-02 | `POST /?action=login` | 200/400/401 | 200/400/401 | 200/400/401 | 正确账号登录成功，错误口令 401 |
| API-03 | `GET /?action=me` | 401 | 200 | 200 | 仅有效会话可通过 |
| API-04 | `POST /?action=logout` | 401 | 200 | 200 | 会话撤销后再次访问 me 应 401 |
| API-05 | `GET /?action=list` | 200 | 200 | 200 | public 只读；user 仅可管理本人资源；admin 全量 |
| API-06 | `POST /?action=sign` | 401 | 200/429/400 | 200/429/400 | 未登录拒绝；限流 429；非法输入 400 |
| API-07 | `POST /?action=updateMeta` | 401 | 200/403/409 | 200/409 | user 不能改他人(403)；并发冲突 409 |
| API-08 | `POST /?action=moveImage` | 401 | 200/403/404 | 200/404 | user 只能移动本人资源 |
| API-09 | `DELETE /?action=deleteImage` | 401 | 200/403 | 200 | user 不能删他人资源 |
| API-10 | `GET /?action=getMeta` | 401 | 403/401 | 200 | 仅 admin 可访问 |
| API-11 | `GET /?action=signDelete` | 401 | 403/401 | 200 | 仅 admin 可访问 |

### 7.3 前端关键链路

文件：`source/gallery/gallery.js`、`source/gallery/index.html`

1. 认证链路
   - 未登录显示“登录/注册”
   - 登录成功后显示会话角色与退出按钮
   - 刷新后会话可恢复；过期后自动清理并提示重登

2. 上传链路（user/admin）
   - 正常上传：签名 -> S3 -> 列表刷新
   - 401：清理本地会话并打开认证弹窗
   - 429：显示“稍后重试”提示

3. 管理链路
   - user：仅可编辑/删除自己的图片
   - admin：可编辑/移动/删除任意图片
   - `updateMeta` 409：提示冲突并刷新列表

### 7.4 边界条件

- 上传大小：`0B`、`10MB`、`10MB+1B`
- MIME：`image/jpeg`、`image/png`、`image/webp`（通过）与非法类型（拒绝）
- 非法 key：空 key、目录穿越、非 `img/gallery/` 前缀
- 分页：`limit=1`、无效 `cursor`、最后一页 `hasMore=false`
- 兼容迁移：老数据仅有 `ownerId` 时，读取后可正常管理并逐步归一

---

## 9. 部署与回滚（Wrangler）

### 8.1 wrangler 基线

文件：`workers/gallery-presign/wrangler.toml`

- 已拆分 `staging` 与 `production`
- `vars` 仅放非敏感配置（`S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`）
- 敏感项必须通过 `wrangler secret put`

### 8.2 Secret 清单

- `SESSION_SECRET`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`

> 若业务要求“仅管理员可注册/开放注册开关”，可额外配置策略类 Secret，但不再依赖旧 `VISITOR_PASSWORD` 双口令模型。

### 8.3 灰度发布流程

1. 本地静态检查
   - `node --check workers/gallery-presign/worker.js`
   - `node --check source/gallery/gallery.js`
2. 发布 staging
   - `npm run deploy -- --env staging`
3. 执行第 7 章回归（至少 API-01~API-11 + 前端关键链路）
4. 观察日志
   - `npm run tail -- --env staging`
5. 满足 Go 条件后发布 production
   - `npm run deploy -- --env production`
6. 生产观察 30~60 分钟，重点关注 5xx 与 401/403/429 波动

### 8.4 回滚预案

触发条件（任一满足即回滚）：

- 持续 5xx 峰值
- 鉴权异常导致写接口大面积失败
- 元数据冲突异常上升并影响主流程

回滚策略：

1. 回滚 Worker 到上一稳定版本
2. 暂停前端相关发布，保证只读链路可用
3. 导出故障窗口日志，在 staging 复现并修复
4. 修复后重新走灰度，不直接热修 production

---

## 10. 结论

当前方案已从旧双口令模型迁移到 D1 账号与会话模型，且前后端主链路已对齐：

- 角色术语统一为 `public / user / admin`
- 认证接口统一为 `register/login/me/logout`
- 写接口统一 session 校验
- 前端认证入口与权限显隐已完成

后续重点是完成 owner 兼容迁移收口、安全基线补强与 staging 全量回归，再切换 production。