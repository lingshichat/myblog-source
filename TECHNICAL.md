# 泠诗的小窝 - 技术文档

> 最后更新：2026-01-03

## 项目概述

这是一个基于 **Hexo** 框架和 **Butterfly** 主题的个人博客。

## 目录结构

```
myblog/
├── _config.yml              # Hexo 主配置
├── _config.butterfly.yml    # Butterfly 主题配置
├── deploy.bat               # 一键部署脚本
├── source/
│   ├── _posts/              # 博客文章
│   ├── _drafts/             # 草稿
│   ├── css/
│   │   └── custom.css       # 自定义样式（整合版）
│   ├── js/
│   │   ├── runtime.js       # 网站运行时间计算
│   │   └── global-bgm.js    # 全局背景音乐控制
│   ├── img/                 # 图片资源
│   ├── categories/          # 分类页面
│   ├── tags/                # 标签页面
│   └── templates/           # Obsidian 文章模板
├── .github/workflows/       # GitHub Actions 自动部署
└── public/                  # 生成的静态文件（勿手动编辑）
```

---

## 资源引用关系

```mermaid
graph TD
    A[_config.butterfly.yml] -->|inject.head| B[/css/custom.css]
    A -->|inject.bottom| C[/js/runtime.js]
    A -->|inject.bottom| D[/js/global-bgm.js]
    D -->|依赖| E[Meting.js / APlayer]
    B -->|样式| F[导航栏/搜索/BGM按钮]
```

### 配置注入位置

| 位置 | 文件 | 用途 |
|------|------|------|
| `inject.head` | `/css/custom.css` | 所有自定义样式 |
| `inject.bottom` | `/js/runtime.js` | 网站运行时间 |
| `inject.bottom` | `/js/global-bgm.js` | BGM 控制 |

---

## 自定义样式 (custom.css)

### 样式分区

| 区块 | 内容 |
|------|------|
| 1. 基础变量 | CSS 变量定义 |
| 2. 导航栏 | 菜单悬停效果、下拉玻璃化 |
| 3. 搜索框 | 图标悬停、弹窗玻璃态 |
| 4. 侧边栏 | Follow Me 按钮呼吸光 |
| 5. 滚动条 | 自定义滚动条样式 |
| 6. BGM 按钮 | 顶栏音乐控制按钮 |
| 7. 页面样式 | 分类/标签/归档页面 |
| 8. 动画 | 呼吸光、旋转动画 |

---

## 自定义脚本

### runtime.js
- **功能**：计算并显示网站运行时间
- **挂载点**：`#runtime_span` 元素
- **更新频率**：250ms

### global-bgm.js
- **功能**：全局背景音乐控制
- **特性**：
  - 使用 Meting.js 播放网易云音乐
  - 顶栏右上角透明按钮
  - 文章内 APlayer 播放时自动暂停 BGM
  - pjax 支持

---

## 部署流程

```
1. 本地编辑 → 2. deploy.bat → 3. Git Push → 4. GitHub Actions → 5. 发布到 Cloudflare/GitHub Pages
```

### 手动部署
```powershell
cd myblog
hexo clean && hexo g && hexo d
```

### 自动部署
运行 `deploy.bat` 或直接 `git push`，GitHub Actions 会自动构建部署。

---

## 常见问题

### Q: 如何修改 BGM 歌曲？
编辑 `source/js/global-bgm.js` 中的 `BGM_CONFIG.songId`。

### Q: 如何修改网站建站时间？
编辑 `source/js/runtime.js` 第 4 行的日期。

### Q: 样式修改后不生效？
运行 `hexo clean && hexo s` 清除缓存后重新预览。

### Q: 如何添加新菜单项？
编辑 `_config.butterfly.yml` 中的 `menu` 配置。
