# 📘 什亭之箱 - 技术文档

> **项目定位**：基于 Hexo + Butterfly 主题的个人博客，配备完整的在线管理系统（Admin + Editor）

---

## 🎯 核心特性

### 📝 内容管理
- **在线编辑器（Editor）**：基于 EasyMDE 的 Markdown 编辑器，支持实时预览、Front Matter 编辑
- **管理后台（Admin）**：全功能控制面板，管理博客配置、文章、短链等
- **博客管理**：在线浏览和编辑所有文章，快速跳转到编辑器

### 🚪 任意门功能（Portal）
- **功能**：子域名 → 外部网站重定向
- **实现**：Cloudflare DNS A 记录 + Redirect Rules
- **示例**：`tv.lingshichat.top` → `https://bilibili.com`
- **特性**：
  - 自动补全 `https://` 协议前缀
  - 实时 URL 预览提示
  - 可在线创建、编辑、删除

### 🔗 短链生成（Shortlinks）
- **功能**：路径 → 目标 URL 重定向
- **实现**：Cloudflare Workers KV + Worker 脚本
- **示例**：`lingshichat.top/s/gh` → `https://github.com`
- **特性**：
  - 自动补全 `https://` 协议前缀
  - 实时 URL 预览提示
  - Worker 路由配置：`lingshichat.top/s/*`

### 📊 监控面板（Monitor）
- **功能**：Cloudflare Analytics 数据可视化
- **数据指标**：
  - 总请求数（Requests）
  - 带宽使用（Bandwidth）
  - 威胁拦截（Threats）
  - 独立访客（Unique Visitors）
- **图表展示**：
  - 24h 流量趋势图（Line Chart - Chart.js）
  - 威胁拦截分布（Bar Chart）
- **刷新频率**：手动刷新

### 🏥 API 健康检查
- **监控对象**：GitHub API、Cloudflare API
- **实时状态**：
  - 连接状态指示（未连接/已连接/连接失败）
  - 延迟测量
  - 最后检查时间（X秒前）
  - 呼吸灯动画（连接成功时）
- **刷新频率**：页面加载时 + 每 30 秒自动检查
- **视觉设计**：品牌原色（GitHub 白色、Cloudflare 橙色）

---

## 🎨 UI/UX 增强

### 🎭 通用确认弹窗模块（ConfirmModal）
- **功能**：替代原生 `alert()` 和 `confirm()`
- **特点**：
  - 玻璃拟物风格设计
  - 支持 info/warning/danger 三种类型
  - Promise 风格 API
  - 键盘快捷键（ESC 关闭）
  - 点击背景关闭
- **使用场景**：Admin 和 Editor 的所有确认操作
- **文档**：[confirm-modal.md](./confirm-modal.md)

### 🔔 Toast 通知系统
- **功能**：优雅的消息通知
- **类型**：success、error、warning、info
- **特性**：
  - 自动消失（可配置时长）
  - 手动关闭按钮
  - 多条消息堆叠显示
  - 平滑动画效果

### 🌈 实时 URL 预览
- **位置**：任意门和短链的目标 URL 输入框
- **功能**：
  - 检测用户输入的 URL
  - 如果缺少 `https://` 前缀，显示预览提示
  - 魔法棒图标 + 补全后的完整 URL
- **样式**：玻璃态卡片，蓝色高光

---

## 🏗️ 技术架构

### 前端技术栈
- **框架**：Vue.js 2.6.14（CDN）
- **编辑器**：EasyMDE（Markdown 编辑）
- **图表**：Chart.js（数据可视化）
- **样式**：自定义 CSS（玻璃拟物风格）
- **图标**：Font Awesome
- **日期选择**：Flatpickr

### 后端服务
- **博客托管**：Cloudflare Pages
- **静态生成**：Hexo 5.5.3
- **主题**：Butterfly（自定义魔改）
- **Git 托管**：GitHub

### Cloudflare 服务
- **DNS**：域名解析 + 任意门 A 记录
- **Redirect Rules**：任意门重定向规则
- **Workers**：短链处理脚本
- **Workers KV**：短链数据存储
- **Analytics**：流量监控数据

---

## 📂 项目结构

```
myblog/
├── source/                    # 网站源文件
│   ├── admin/                # 管理后台
│   │   ├── index.html        # 后台 UI
│   │   ├── admin.js          # Vue.js 核心逻辑
│   │   ├── admin.css         # 样式（玻璃拟物风格）
│   │   ├── config.js         # 配置文件
│   │   └── api/
│   │       ├── auth.js       # 认证模块
│   │       └── cloudflare.js # Cloudflare API 封装
│   ├── editor/               # 文章编辑器
│   │   ├── index.html
│   │   ├── app.js
│   │   ├── style.css
│   │   ├── auth.js
│   │   └── config.js
│   ├── js/                   # 公共模块
│   │   ├── toast-module.js   # Toast 通知模块
│   │   ├── confirm-modal.js  # 确认弹窗模块
│   │   ├── admin-portal.js   # 后台入口（水晶球）
│   │   ├── shooting_stars.js # 流星彩蛋
│   │   └── global-bgm.js     # 全局音乐
│   ├── easter-egg/           # 彩蛋页面
│   ├── _posts/               # 文章存储
│   ├── _trash/               # 回收站
│   └── _drafts/              # 草稿箱
├── workers/                   # Cloudflare Worker 脚本
│   └── shortlink-redirect.js # 短链重定向服务
├── docs/                      # 技术文档（本文档所在位置）
│   ├── README.md             # 文档目录
│   ├── TECHNICAL.md          # 技术文档（本文档）
│   ├── confirm-modal.md      # 确认弹窗模块文档
│   └── workers-deployment.md # Worker 部署指南
├── _config.yml               # Hexo 配置
├── _config.butterfly.yml     # 主题配置
├── CODING_STYLE.md           # 编码规范
└── package.json              # 依赖管理
```

---

## 🔐 安全与认证

### 认证机制
- **密码加密存储**：使用 CryptoJS AES 加密 GitHub Token
- **会话管理**：LocalStorage 存储会话（24小时有效期）
- **共享会话**：Admin 和 Editor 共享认证状态
- **Token 保护**：Token 从不明文传输或存储

### API 权限要求

#### GitHub Token 权限
```
repo (完整仓库访问权限)
```

#### Cloudflare Token 权限
```
Zone.Zone: Read
Zone.DNS: Edit
Zone.Cache Purge: Purge
Zone.Zone Settings: Edit
Zone.Analytics: Read
Account.Workers KV Storage: Edit
Account.Workers Scripts: Edit
```

---

## 🚀 部署流程

### 本地开发
```bash
# 安装依赖
npm install

# 本地预览
hexo cl && hexo g && hexo s
```

### 部署到 Cloudflare Pages
```bash
# 方式 1：使用部署脚本
./deploy.bat

# 方式 2：手动推送
git add .
git commit -m "Update content"
git push origin main
# Cloudflare Pages 自动触发构建
```

### Worker 部署
参考：[workers-deployment.md](./workers-deployment.md)

1. 在 Cloudflare Dashboard 创建 Worker
2. 粘贴 `workers/shortlink-redirect.js` 代码
3. 绑定 KV Namespace：`LINK_KV` → `blog_shortlinks`
4. 配置路由：`lingshichat.top/s/*`

---

## 🎨 设计规范

### 命名规范
- **JavaScript**：驼峰命名（camelCase）
- **Python**：下划线命名（snake_case）
- **常量**：大写下划线（UPPER_CASE）
- **CSS 类**：短横线命名（kebab-case）

详见：[CODING_STYLE.md](../CODING_STYLE.md)

### UI 风格
- **主题**：深色玻璃拟物风格
- **配色**：
  - 主色：`#3b70fc`（蓝色）
  - 成功：`#10b981`（绿色）
  - 警告：`#fbbf24`（黄色）
  - 危险：`#ef4444`（红色）
- **特效**：
  - 玻璃态背景（`backdrop-filter: blur()`）
  - 内阴影拟物效果
  - 平滑动画（`cubic-bezier`）
  - 微光反射（hover 时）

---

## 🐛 故障排除

### 常见问题

#### 1. 任意门重定向失败
**症状**：访问 `xxx.lingshichat.top` 跳转到错误 URL
**原因**：目标 URL 缺少协议前缀
**解决**：删除错误规则，重新创建（系统会自动补全 `https://`）

#### 2. 短链不工作
**症状**：访问 `lingshichat.top/s/xxx` 返回 404
**原因**：Worker KV 绑定配置错误
**解决**：检查 Worker 设置中的 KV Namespace 绑定（变量名必须是 `LINK_KV`）

#### 3. Hexo 构建失败
**症状**：`hexo g` 报错 YAML 解析错误
**原因**：`source/` 目录下有 `.md` 文件被误当作博客文章
**解决**：将技术文档移到根目录的 `docs/` 文件夹

#### 4. API 健康检查失败
**症状**：显示"连接失败"或"未连接"
**原因**：Token 权限不足或 CORS 问题
**解决**：
  - 检查 Token 是否有正确的权限
  - 检查浏览器控制台是否有 CORS 错误
  - 确认 Token 未过期

---

## 📊 功能清单

### ✅ 已实现
- [x] 在线编辑器（Editor）
- [x] 管理后台（Admin Dashboard）
- [x] 任意门功能（Portal）
- [x] 短链生成（Shortlinks + Worker）
- [x] 监控面板（Analytics + Charts）
- [x] API 健康检查（实时状态）
- [x] Toast 通知系统
- [x] 通用确认弹窗模块
- [x] URL 自动补全
- [x] 博客管理（文章列表）
- [x] 系统设置（在线编辑配置）
- [x] 回收站功能
- [x] 流星彩蛋
- [x] 全局背景音乐

### 🚧 规划中
- [ ] 评论管理
- [ ] 图片上传和管理
- [ ] 深色/浅色主题切换
- [ ] 移动端优化
- [ ] 数据导出功能
- [ ] 访客留言板

---

## 📝 更新日志

### 2026-01-07
- ✨ 新增：通用确认弹窗模块（ConfirmModal）
- ✨ 新增：短链功能 URL 自动补全
- ✨ 新增：任意门功能 URL 自动补全
- ✨ 新增：实时 URL 预览提示
- ✨ 新增：监控面板图表展示（Chart.js）
- 🐛 修复：任意门重定向协议缺失问题
- 🐛 修复：短链删除功能
- 📝 文档：创建 `docs/` 技术文档文件夹
- 🔧 重构：统一使用 Toast 和 ConfirmModal 替代原生弹窗

### 2026-01-06
- ✨ 新增：API 健康检查（实时监控 GitHub/Cloudflare 连接状态）
- ✨ 新增：任意门管理功能
- ✨ 新增：短链管理功能（KV 存储）
- ✨ 新增：监控面板（Cloudflare Analytics）
- ✨ 新增：博客管理（文章列表和搜索）
- ✨ 新增：系统设置（在线修改配置）
- 🎨 优化：管理后台 UI（玻璃拟物风格）
- 🎨 优化：流星动画效果

---

## 🔗 相关链接

- **博客地址**：https://lingshichat.top
- **管理后台**：https://lingshichat.top/admin/
- **在线编辑器**：https://lingshichat.top/editor/
- **GitHub 仓库**：[用户私有仓库]
- **Cloudflare Dashboard**：https://dash.cloudflare.com

---

## 📧 联系方式

有问题或建议？欢迎通过以下方式联系：
- 博客评论
- GitHub Issues
- 邮件联系

---

**最后更新**：2026-01-07  
**文档版本**：v2.0
