# 泠诗的存图站 - 开发工作日记

**开发日期**：2026年2月23日  
**项目**：泠诗的存图站 (Gallery & Uploader)  
**分支**：feature/gallery-uploader

---

## 一、项目背景

为 Hexo 博客（Butterfly 主题）开发一个独立的图床相册页面，具备以下功能：
- 公开的图片展示墙（瀑布流）
- 私人的图片上传工具
- 遵循缤纷云最佳实践，不在前端暴露 S3 密钥

---

## 二、技术架构

### 后端
- **Cloudflare Worker**：预签名鉴权服务
- 原生 AWS Signature V4 签名（无 AWS SDK 依赖，体积仅 14KB）
- 元数据存储：`img/gallery/_metadata.json`

### 前端
- Vue 2.x (CDN)
- 玻璃拟态 UI 设计 (Glassmorphism)
- 瀑布流布局 + Fancybox 灯箱

---

## 三、完成的功能

### 1. 基础功能
- [x] 图片瀑布流展示
- [x] 缩略图加载（缤纷云 CoreIX）
- [x] 灯箱预览（Fancybox）
- [x] 复制 Markdown/URL

### 2. 上传功能
- [x] 全局拖拽上传
- [x] 粘贴板粘贴上传 (Ctrl+V)
- [x] 悬浮按钮 (FAB) 上传
- [x] 上传进度条
- [x] 安全预签名上传（不暴露密钥）

### 3. 分类管理
- [x] 分类菜单栏（全部/二次元/风景/美图/人像）
- [x] 上传时选择分类（存到对应目录）
- [x] 按分类筛选图片

### 4. 元数据（Phase 2）
- [x] 上传时填写标题
- [x] 上传时添加标签
- [x] 图片卡片显示标题和标签

### 5. 管理后台（Phase 2）
- [x] 右上角管理入口（齿轮图标）
- [x] 管理员验证登录
- [x] 图片编辑弹窗（修改标题/标签）
- [x] 移动图片到其他分类
- [x] 删除图片

### 6. BlurHash 占位图
- [x] Worker 返回 blurhashUrl
- [x] 前端可使用（需前端库解码）

---

## 四、目录结构

```
myblog/
├── workers/gallery-presign/
│   ├── worker.js          # 预签名服务 + 元数据管理
│   ├── package.json       # 依赖配置
│   └── wrangler.toml      # 部署配置
│
├── source/gallery/
│   ├── index.html         # 主页面
│   ├── gallery.css        # 样式
│   └── gallery.js         # 核心逻辑
│
├── _config.yml            # 已添加 gallery 到 skip_render
└── _config.butterfly.yml  # 已添加导航菜单
```

---

## 五、Worker API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `?action=list&prefix=` | GET | 获取图片列表 |
| `?action=sign&key=&type=` | GET | 获取上传签名 |
| `?action=getMeta` | GET | 获取元数据 |
| `?action=updateMeta` | POST | 更新元数据（需鉴权） |
| `?action=moveImage` | POST | 移动图片（需鉴权） |
| `?action=deleteImage&key=` | DELETE | 删除图片（需鉴权） |

---

## 六、缤纷云配置

- **存储桶**：lingshichat
- **Endpoint**：https://s3.bitiful.net
- **Region**：cn-east-1
- **目录结构**：
  ```
  img/gallery/
  ├── 二次元/
  ├── 风景/
  ├── 美图/
  ├── 人像/
  └── _metadata.json
  ```

---

## 七、部署信息

- **Worker URL**：https://gallery-presign.lingshichat.workers.dev
- **页面 URL**：https://lingshichat.top/gallery/

---

## 八、后续优化建议

1. **移除访问密钥**：当前为开放模式，登录界面可简化
2. **BlurHash 解码**：前端集成 blurhash 库实现占位图
3. **标签云**：显示所有标签，点击筛选
4. **搜索功能**：按标题/标签搜索图片
5. **批量操作**：批量移动、批量删除

---

## 九、经验总结

1. **签名方案**：缤纷云推荐预签名 URL 方案，但我们采用了签名头方案（更灵活）
2. **元数据存储**：使用 S3 JSON 文件存储，比 Cloudflare D1 更简单
3. **目录分类**：用 S3 目录前缀实现分类，简单可靠
4. **UI 设计**：沿用博客已有的玻璃拟态风格，保持一致性

---

*End of Document*
