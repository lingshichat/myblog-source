# 📚 技术文档目录

本文件夹用于存放项目相关的技术文档、使用指南和开发说明。

---

## 📋 文档列表

### 🎭 前端模块

- **[confirm-modal.md](./confirm-modal.md)** - 通用确认弹窗模块使用指南
  - 功能：优雅的模态框 UI，替代原生 `alert()` 和 `confirm()`
  - 适用：Admin、Editor 等所有页面

### ☁️ Cloudflare Worker

- **[worker-deployment.md](./worker-deployment.md)** - Worker 部署指南
  - 功能：短链重定向服务部署说明
  - 包含：完整的配置步骤和测试方法

---

## 📁 文档结构规范

所有技术文档应遵循以下命名和格式规范：

### 命名规范
- 使用小写字母 + 短横线（kebab-case）
- 文件名应简洁明了，反映文档主题
- 示例：`confirm-modal.md`, `worker-deployment.md`

### 格式规范
- 使用 Markdown 格式
- 包含清晰的标题层级
- 提供使用示例和代码片段
- 必要时添加故障排除部分

---

## 🔄 更新日志

| 日期 | 文档 | 说明 |
|------|------|------|
| 2026-01-07 | confirm-modal.md | 创建通用确认弹窗模块文档 |
| 2026-01-07 | worker-deployment.md | 创建 Worker 部署指南 |

---

**注意**：本文件夹位于根目录，不会被 Hexo 处理为博客文章。
