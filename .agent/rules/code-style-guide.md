---
trigger: always_on
---

# 什亭之箱项目编码规范 (Shiting Chest Coding Standards)

> **⚠️ 绝对指令 (CRITICAL INSTRUCTIONS)**
> 本文档定义了项目中所有代码的命名、架构和格式规范。所有的 AI Agent 在编写代码前 **必须** 阅读并严格遵守以下规则。

---

## 👑 0. 核心原则 (Core Principles)

### 0.1 Serverless First (无服务器优先)
* 架构设计永远优先考虑 **Cloudflare Worker + KV/D1**
* **禁止** 引入需要维护服务器的组件（如本地 MySQL、Redis、Docker 等）
* 保持架构的"轻量化"和"零维护"

### 0.2 语言隔离 (Language Specifics)
* **前端/Worker (JavaScript)**: 严格遵守 `camelCase` (驼峰命名)
* **后端/脚本 (Python)**: 严格遵守 `snake_case` (下划线命名)
* **禁止混用**：不要把 JS 习惯带到 Python，反之亦然

### 0.3 注释规范 (Documentation)
* 关键业务逻辑 **必须** 使用 **中文** 编写注释，方便查阅
* 复杂算法需要解释思路
* 公共 API 需要说明参数和返回值

## 📋 命名规范

### 1. 变量命名

#### 1.1 常量（Configuration Constants）
**规则:** 全大写 + 下划线分隔

```javascript
// ✅ 推荐
const GITHUB_TOKEN = "xxx";
const CF_ZONE_ID = "xxx";
const POSTS_PATH = "source/_posts";
const MAX_RETRY_COUNT = 3;

// ❌ 不推荐
const githubToken = "xxx";
const cfZoneId = "xxx";
```

**使用场景:**
- 配置文件中的所有配置项
- 不会改变的全局常量
- API 端点、密钥等敏感配置

---

#### 1.2 普通变量
**规则:** 驼峰命名（camelCase）

```javascript
// ✅ 推荐
let userName = "张三";
let postList = [];
let currentIndex = 0;
let editorInstance = null;

// ❌ 不推荐
let user_name = "张三";
let PostList = [];
let current_index = 0;
```

**使用场景:**
- 函数内的局部变量
- Vue data 中的响应式变量
- 临时变量、循环变量

---

#### 1.3 布尔值变量
**规则:** `is/has/can/should` 前缀 + 驼峰命名

```javascript
// ✅ 推荐
let isLoggedIn = false;
let hasPermission = true;
let canEdit = false;
let shouldRefresh = true;
let isLoading = false;

// ❌ 不推荐
let loggedIn = false;
let permission = true;
let loading = false;
```

**常用前缀:**
- `is`: 表示状态（isActive, isVisible, isEnabled）
- `has`: 表示拥有（hasData, hasError, hasPermission）
- `can`: 表示能力（canEdit, canDelete, canSubmit）
- `should`: 表示应该（shouldUpdate, shouldValidate）

---

#### 1.4 私有变量
**规则:** 下划线前缀 + 驼峰命名

```javascript
// ✅ 推荐（私有变量）
let _internalState = {};
let _cache = new Map();
let _tempData = null;

// ✅ 推荐（公开变量）
let publicData = {};
```

**使用场景:**
- 模块内部使用，不对外暴露的变量
- 临时缓存、内部状态管理

---

### 2. 函数命名

#### 2.1 普通函数
**规则:** 驼峰命名 + 动词开头

```javascript
// ✅ 推荐
function fetchPosts() { }
function saveConfig(data) { }
function parseYamlContent(text) { }
function renderMarkdown(content) { }

// ❌ 不推荐
function posts() { }
function config_save() { }
function ParseYaml() { }
```

**常用动词:**
- `get/fetch`: 获取数据（getPosts, fetchUserData）
- `set/update`: 设置/更新（setTitle, updateStatus）
- `create/add`: 创建/添加（createPost, addTag）
- `delete/remove`: 删除/移除（deleteFile, removeItem）
- `save/load`: 保存/加载（saveConfig, loadSettings）
- `parse/format`: 解析/格式化（parseJSON, formatDate）
- `validate/check`: 验证/检查（validateInput, checkPermission）

---

#### 2.2 事件处理函数
**规则:** `handle/on` 前缀 + 驼峰命名

```javascript
// ✅ 推荐
function handleClick() { }
function onSubmit() { }
function handleInputChange(e) { }
function onModalClose() { }

// ❌ 不推荐
function clickHandler() { }
function submit() { }
function inputChange() { }
```

---

#### 2.3 异步函数
**规则:** 使用 `async` 关键字，命名同普通函数

```javascript
// ✅ 推荐
async function fetchPosts() {
    const response = await api.get('/posts');
    return response.data;
}

async function savePost(data) {
    await api.post('/posts', data);
}

// ✅ 也可以（在需要区分同步版本时）
async function loadPostsAsync() { }
function loadPostsSync() { }
```

---

### 3. 文件命名

#### 3.1 模块/工具文件
**规则:** 短横线命名（kebab-case）

```
✅ 推荐
toast-module.js
admin-portal.js
shooting-stars.js
global-bgm.js

❌ 不推荐
toastModule.js
AdminPortal.js
shooting_stars.js
```

---

#### 3.2 配置文件
**规则:** 小写，单词简洁

```
✅ 推荐
config.js
auth.js
style.css

❌ 不推荐
Config.js
authentication-module.js
```

---

#### 3.3 组件文件（如果使用框架）
**规则:** 大驼峰（PascalCase）或短横线命名

```
✅ 推荐（Vue/React）
EditorView.vue
PostList.vue
UserProfile.vue

✅ 也可以
editor-view.vue
post-list.vue
user-profile.vue
```

---

## 🐍 4. Python 编码规范 (Streamlit / Scripts)

### 4.1 变量与函数 (snake_case)

**规则:** 全部使用小写字母和下划线。这是 Python 的铁律！

```python
# ✅ 推荐
user_name = "Sensei"
post_count = 0
current_status = "active"

def get_user_info(user_id: int):
    """获取用户信息"""
    pass

def fetch_blog_posts():
    """获取博客文章列表"""
    pass

# ❌ 绝对禁止
userName = "Sensei"  # 不要把 JS 习惯带过来！
def getUserInfo():
    pass
```

**使用场景:**
- 所有 Python 文件中的变量和函数
- Streamlit 应用中的状态变量
- 工具脚本和自动化脚本

---

### 4.2 类名 (PascalCase)

**规则:** 大驼峰命名（每个单词首字母大写）

```python
# ✅ 推荐
class BlogConfig:
    pass

class CloudflareAPI:
    pass

class UserManager:
    def __init__(self):
        self.users = []

# ❌ 不推荐
class blog_config:
    pass
```

---

### 4.3 常量 (UPPER_CASE)

**规则:** 全大写 + 下划线

```python
# ✅ 推荐
MAX_RETRIES = 3
DEFAULT_TIMEOUT = 10
API_BASE_URL = "https://api.example.com"

# ❌ 不推荐
maxRetries = 3
```

---

### 4.4 私有方法/变量

**规则:** 单下划线前缀

```python
class MyClass:
    def __init__(self):
        self._internal_state = {}  # 私有变量
    
    def _internal_method(self):  # 私有方法
        pass
    
    def public_method(self):  # 公开方法
        pass
```

---

### 4.5 类型注解

**规则:** 推荐使用类型注解，提高代码可读性

```python
# ✅ 推荐
def process_post(post_id: int, title: str) -> dict:
    """处理文章
    
    Args:
        post_id: 文章ID
        title: 文章标题
    
    Returns:
        处理结果字典
    """
    return {"id": post_id, "title": title}

# 变量类型注解
posts: list[dict] = []
user_name: str = "张三"
```

---

## 👷 5. Cloudflare Worker 规范

### 5.1 环境变量 (Environment Variables)

**规则:** Token 和 ID 必须从 `env` 对象中获取，**禁止硬编码**

```javascript
// ✅ 正确
export default {
    async fetch(request, env, ctx) {
        const token = env.CF_API_TOKEN;
        const zoneId = env.CF_ZONE_ID;
        const kvNamespace = env.SHORT_LINKS;
        
        // 使用环境变量
        const response = await fetch(apiUrl, {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });
        
        return new Response("OK");
    }
};

// ❌ 错误：不要把密钥写死在代码里！
const token = "1234567890abcdef...";
const zoneId = "abc123...";
```

**绑定配置示例（wrangler.toml）:**
```toml
[env.production]
vars = { }

[[env.production.kv_namespaces]]
binding = "SHORT_LINKS"
id = "your-kv-namespace-id"

[env.production.vars]
CF_ZONE_ID = "your-zone-id"
```

---

### 5.2 响应头 (CORS Headers)

**规则:** 所有 API 响应必须包含 CORS 头，允许博客域名访问

```javascript
// ✅ 推荐：统一的响应头函数
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status: status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*", // 或指定域名
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
    });
}

// 使用示例
export default {
    async fetch(request, env, ctx) {
        // 处理 OPTIONS 预检请求
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type"
                }
            });
        }
        
        // 返回 JSON 数据
        return jsonResponse({ success: true, data: "Hello" });
    }
};
```

---

### 5.3 错误处理

**规则:** 统一的错误处理和响应格式

```javascript
// ✅ 推荐
async function handleRequest(request, env) {
    try {
        // 业务逻辑
        const data = await fetchData();
        return jsonResponse({ success: true, data });
        
    } catch (error) {
        console.error("处理请求失败:", error);
        
        return jsonResponse({
            success: false,
            error: error.message || "Internal Server Error"
        }, 500);
    }
}

// ❌ 不推荐：直接抛出错误
async function badHandler(request, env) {
    const data = await fetchData(); // 如果失败会直接抛出
    return new Response(JSON.stringify(data));
}
```

---

### 5.4 KV 存储操作

**规则:** 使用命名空间绑定，添加错误处理

```javascript
// ✅ 推荐
export default {
    async fetch(request, env, ctx) {
        const { pathname } = new URL(request.url);
        const key = pathname.slice(1); // 移除开头的 /
        
        try {
            // 读取 KV
            const value = await env.SHORT_LINKS.get(key);
            
            if (!value) {
                return jsonResponse({ error: "Not found" }, 404);
            }
            
            // 写入 KV（带过期时间）
            await env.SHORT_LINKS.put(key, value, {
                expirationTtl: 86400 // 24 小时
            });
            
            return Response.redirect(value, 302);
            
        } catch (error) {
            console.error("KV 操作失败:", error);
            return jsonResponse({ error: "Internal error" }, 500);
        }
    }
};
```

---

## 🎨 6. CSS 类名命名

#### 4.1 组件类名
**规则:** BEM 方法论（Block__Element--Modifier）

```css
/* ✅ 推荐 */
.toast-container { }
.toast__message { }
.toast--success { }
.modal-overlay { }
.modal__header { }
.modal__close-btn { }

/* ❌ 不推荐 */
.toastContainer { }
.toast_message { }
.modalclosebutton { }
```

---

#### 4.2 工具类
**规则:** 短横线命名，语义化

```css
/* ✅ 推荐 */
.text-center { }
.d-flex { }
.mb-3 { }
.btn-primary { }

/* ❌ 不推荐 */
.textCenter { }
.display_flex { }
```

---

## 📦 7. 项目结构规范

### 7.1 目录命名
- 全小写
- 使用短横线分隔多个单词
- 见名知义

```
myblog/
├── source/              # 网站源文件
│   ├── admin/          # 管理后台 (Vue/HTML)
│   ├── editor/         # 文章编辑器 (Vue/HTML)
│   ├── js/             # 公共 JavaScript 模块
│   ├── css/            # 公共样式
│   ├── easter-egg/     # 彩蛋页面
│   ├── _posts/         # 文章存储 (Markdown)
│   ├── _trash/         # 回收站
│   └── _drafts/        # 草稿箱
│
├── workers/             # Cloudflare Worker 脚本
│   ├── short-link.js   # 短链服务
│   ├── guestbook.js    # 留言板 API
│   └── wrangler.toml   # Worker 配置
│
├── scripts/             # Python 工具脚本
│   ├── deploy.py       # 部署脚本
│   └── backup.py       # 备份脚本
│
├── app.py              # Streamlit 后端入口（如果有）
├── CODING_STYLE.md     # 编码规范文档（本文档）
└── README.md           # 项目说明
```

### 7.2 文件组织原则
- **前端代码** (`source/`): 所有面向用户的页面和资源
- **Worker 脚本** (`workers/`): 所有 Cloudflare Worker 代码
- **Python 脚本** (`scripts/`): 构建、部署、维护工具
- **配置文件**: 放在对应子目录中（如 `admin/config.js`）

---

## 🎯 8. 代码格式规范

### 缩进
- **JavaScript/HTML/CSS**: 使用 **4 个空格** 缩进
- **Python**: 使用 **4 个空格** 缩进
- 禁止使用 Tab

### 引号
- **JavaScript**: 优先使用**双引号** `"`
- **Python**: 优先使用**双引号** `"`
- **HTML 属性**: 使用双引号 `"`

### 分号
- JavaScript 语句结尾**必须加分号** `;`
- Python 无需分号

### 注释
**JavaScript:**
```javascript
// 单行注释：说明下一行代码的作用

/**
 * 多行注释：函数/模块说明
 * @param {string} name - 用户名
 * @returns {Object} 用户对象
 */
function getUser(name) {
    // 实现逻辑
}
```

**Python:**
```python
# 单行注释：说明下一行代码的作用

def get_user(name: str) -> dict:
    """获取用户信息
    
    Args:
        name: 用户名
    
    Returns:
        用户信息字典
    """
    pass
```

---

## ✅ 9. 代码提交前检查清单

### JavaScript / Worker
- [ ] 所有变量使用驼峰命名 (camelCase)
- [ ] 常量使用大写+下划线 (UPPER_CASE)
- [ ] 布尔值有明确的 `is/has/can` 前缀
- [ ] 函数名以动词开头
- [ ] 文件名使用短横线命名 (kebab-case)
- [ ] 代码缩进为 4 空格
- [ ] 无硬编码的 Token 或密钥
- [ ] Worker 使用环境变量 `env` 对象
- [ ] API 响应包含 CORS 头
- [ ] 有必要的中文注释说明

### Python
- [ ] 所有变量/函数使用下划线命名 (snake_case)
- [ ] 类名使用大驼峰命名 (PascalCase)
- [ ] 常量使用大写+下划线 (UPPER_CASE)
- [ ] 使用类型注解 (Type Hints)
- [ ] 函数有完整的 docstring
- [ ] 代码缩进为 4 空格
- [ ] 有必要的中文注释说明

### 通用
- [ ] 无硬编码的魔法数字或字符串
- [ ] 配置集中在 config 文件
- [ ] 遵循 Serverless First 原则
- [ ] 代码可读性良好

---

## 📌 特殊约定

### Vue 组件 data 命名
```javascript
data: {
    // 推荐：布尔值有前缀
    isLoggedIn: false,
    isLoading: true,
    hasError: false,
    
    // 推荐：列表用复数
    posts: [],
    users: [],
    
    // 推荐：当前选中项用 current 前缀
    currentPost: null,
    currentView: 'dashboard'
}
```

### API 配置常量
```javascript
// 在 config.js 中
export const CONFIG = {
    // GitHub 相关
    GITHUB_TOKEN: "xxx",
    OWNER: "xxx",
    REPO: "xxx",
    
    // Cloudflare 相关
    CF_TOKEN: "xxx",
    CF_ZONE_ID: "xxx",
    
    // 路径配置
    POSTS_PATH: "source/_posts",
    TRASH_PATH: "source/_trash"
};
```

---

遵循这些规范，让代码更清晰、更易维护！🎉
