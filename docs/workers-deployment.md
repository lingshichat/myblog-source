# 🚀 Cloudflare Workers 部署指南

本项目包含以下 Worker 脚本：

## 📝 Worker 列表

### 1. `shortlink-redirect.js` - 短链重定向服务

**功能**：拦截主域名路径请求，从 KV 读取目标 URL 并重定向

**使用场景**：
- `lingshichat.top/go` → 重定向到存储的目标 URL
- `lingshichat.top/abc` → 重定向到存储的目标 URL

---

## 🛠️ 部署步骤

### 方法 A：通过 Cloudflare Dashboard（推荐）

#### Step 1: 创建 Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 选择你的账户 → **Workers & Pages**
3. 点击 **Create Application** → **Create Worker**
4. 命名为 `shortlink-redirect`（或其他名称）
5. 点击 **Deploy** 创建默认 Worker

#### Step 2: 编辑代码

1. 在 Worker 详情页，点击 **Quick Edit**
2. 删除默认代码，粘贴 `shortlink-redirect.js` 的全部内容
3. 点击 **Save and Deploy**

#### Step 3: 绑定 KV Namespace

1. 在 Worker 详情页，点击 **Settings** 标签
2. 找到 **Variables** 部分，点击 **Add binding**
3. 选择 **KV Namespace**
4. 配置：
   - **Variable name**: `SHORT_LINKS`（必须与代码中 `env.SHORT_LINKS` 一致）
   - **KV namespace**: 选择你在管理后台创建的 `blog_shortlinks`
5. 点击 **Save**

#### Step 4: 绑定到主域名

1. 在 Cloudflare Dashboard，选择你的域名 `lingshichat.top`
2. 进入 **Workers Routes** (在左侧菜单的 **Workers** 下)
3. 点击 **Add route**
4. 配置路由：
   ```
   Route: lingshichat.top/*
   Worker: shortlink-redirect
   ```
   
   **⚠️ 重要提示**：
   - 如果你的博客也部署在主域名，这会拦截所有请求！
   - **推荐方案**：
     - 方案 1: 使用路径前缀 `lingshichat.top/s/*` 或 `lingshichat.top/go/*`
     - 方案 2: 使用子域名 `s.lingshichat.top/*`

5. 点击 **Save**

---

### 方法 B：使用 Wrangler CLI（高级）

如果你熟悉命令行，也可以使用 Wrangler：

```bash
# 安装 Wrangler
npm install -g wrangler

# 登录
wrangler login

# 创建 wrangler.toml 配置文件（参考下方）
# 然后部署
wrangler deploy
```

**wrangler.toml 示例**：
```toml
name = "shortlink-redirect"
main = "workers/shortlink-redirect.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "SHORT_LINKS"
id = "your-kv-namespace-id"

[env.production]
routes = [
  { pattern = "lingshichat.top/s/*", zone_name = "lingshichat.top" }
]
```

---

## 🧪 测试

部署完成后，测试短链功能：

1. 在管理后台创建一个短链：
   - Key: `go`
   - URL: `https://github.com`

2. 访问 `lingshichat.top/go`（或 `lingshichat.top/s/go`，取决于路由配置）

3. 应该自动跳转到 GitHub

---

## 🎨 自定义配置

### 修改路径前缀

如果想只拦截特定前缀（如 `/s/` 或 `/go/`），在代码中取消注释：

```javascript
// 取消注释这段
if (!url.pathname.startsWith('/s/') && !url.pathname.startsWith('/go/')) {
    return fetch(request); // 放行到源站
}

// 并取消注释这行
key = key.replace(/^(s|go)\//, '');
```

### 修改 404 页面

自定义短链不存在时的响应：

```javascript
return new Response('自定义 404 消息', {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
});
```

---

## 📊 监控与日志

在 Cloudflare Dashboard 的 Worker 详情页：
- **Analytics** 标签：查看请求量、错误率
- **Logs** 标签：实时查看日志（需要开启 Tail Workers）

---

## ⚠️ 注意事项

1. **KV 绑定名称必须匹配**：代码中使用 `env.SHORT_LINKS`，绑定时 Variable name 必须是 `SHORT_LINKS`
2. **路由优先级**：Worker Routes 优先于 Page Rules，小心配置避免冲突
3. **免费额度**：Cloudflare 免费计划每天 10 万次请求，通常足够个人博客使用

---

有问题？查看 [Cloudflare Workers 官方文档](https://developers.cloudflare.com/workers/)
