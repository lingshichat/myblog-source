# 🎭 通用确认弹窗模块使用指南

## 📝 简介

`confirm-modal.js` 是一个通用的确认弹窗模块，提供优雅的模态框 UI，替代原生的 `alert()` 和 `confirm()`。

**特点：**
- ✨ 精美的玻璃拟物风格设计
- 🎨 支持多种类型（info、warning、danger）
- ⚡ Promise 风格 API，易于使用
- 🔄 全站可复用
- 📱 响应式设计

---

## 🚀 快速开始

### 1. 引入模块

```javascript
import { ConfirmModal } from './js/confirm-modal.js';
```

### 2. 确认弹窗

```javascript
const confirmed = await ConfirmModal.show({
    title: '删除确认',
    message: '确定要删除这条记录吗？',
    confirmText: '删除',
    cancelText: '取消',
    type: 'danger' // 'info' | 'warning' | 'danger'
});

if (confirmed) {
    // 用户点击了确定
    console.log('用户确认');
} else {
    // 用户点击了取消
    console.log('用户取消');
}
```

### 3. 提示弹窗（仅确认按钮）

```javascript
await ConfirmModal.alert({
    title: '提示',
    message: '操作成功！',
    confirmText: '知道了',
    type: 'info'
});
```

---

## 🎨 参数说明

### `ConfirmModal.show(options)`

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `title` | String | `'确认'` | 弹窗标题 |
| `message` | String | `''` | 弹窗消息内容 |
| `confirmText` | String | `'确定'` | 确认按钮文字 |
| `cancelText` | String | `'取消'` | 取消按钮文字 |
| `type` | String | `'info'` | 弹窗类型：`'info'` / `'warning'` / `'danger'` |

**返回值**：`Promise<boolean>` - `true` 表示用户确认，`false` 表示用户取消

### `ConfirmModal.alert(options)`

与 `show()` 相同，但只显示确认按钮（无取消按钮）

---

## 📚 使用示例

### 示例 1：删除确认（危险操作）

```javascript
async deleteItem(item) {
    const confirmed = await ConfirmModal.show({
        title: '删除确认',
        message: `确定要删除 "${item.name}" 吗？\n\n此操作不可撤销！`,
        confirmText: '删除',
        cancelText: '取消',
        type: 'danger'
    });
    
    if (!confirmed) return;
    
    // 执行删除操作
    await api.delete(item.id);
    this.showToast('删除成功', 'success');
}
```

### 示例 2：警告提示

```javascript
async saveChanges() {
    const confirmed = await ConfirmModal.show({
        title: '保存修改',
        message: '确定要保存这些修改吗？',
        confirmText: '保存',
        cancelText: '取消',
        type: 'warning'
    });
    
    if (confirmed) {
        await this.save();
    }
}
```

---

## 🎯 已集成页面

| 页面 | 使用场景 |
|------|----------|
| **Admin** | 任意门删除、短链删除 |
| **Editor** | 文章删除、还原、彻底删除 |

---

## 🔧 自定义样式

模块自动注入样式，无需额外配置。如需自定义，可编辑 `confirm-modal.js` 中的 `injectStyles()` 方法。

### 主要 CSS 类：

- `.confirm-modal-overlay` - 遮罩层
- `.confirm-modal-container` - 弹窗容器
- `.confirm-modal-header` - 标题区域
- `.confirm-modal-body` - 内容区域
- `.confirm-modal-footer` - 按钮区域

---

## ⚡ 特性

### 1. 键盘快捷键

- **ESC** - 关闭弹窗（取消）

### 2. 点击背景关闭

点击遮罩层（弹窗外部）会关闭弹窗（相当于取消）

### 3. 类型自动样式

不同类型有不同的图标和颜色：

- **info** 🔵 - 蓝色圆圈信息图标
- **warning** ⚠️ - 黄色三角警告图标
- **danger** 🔴 - 红色圆圈警告图标

---

## 📖 最佳实践

### ✅ 推荐

```javascript
// 使用描述性的标题和信息
const confirmed = await ConfirmModal.show({
    title: '删除文章',
    message: '确定要删除 "Hello World" 吗？\n\n删除后将移至回收站，可在 30 天内恢复。',
    confirmText: '移至回收站',
    cancelText: '取消',
    type: 'warning'
});
```

### ❌ 不推荐

```javascript
// 信息过于简单
const confirmed = await ConfirmModal.show({
    message: '确定吗？'
});
```

---

## 🐛 故障排除

### 问题：弹窗不显示

**解决**：确保在 HTML 中正确引入了模块：

```html
<script type="module" src="./admin.js"></script>
```

### 问题：样式错乱

**解决**：检查是否有 CSS 冲突，`z-index` 已设置为 `10000`，通常不会被覆盖。

---

## 🔄 与原生 API 对比

| 原生 API | ConfirmModal | 优势 |
|----------|--------------|------|
| `confirm()` | `ConfirmModal.show()` | 更美观、可定制类型、Promise 风格 |
| `alert()` | `ConfirmModal.alert()` | 更美观、支持多行消息 |

---

需要帮助？查看 `confirm-modal.js` 源码了解更多实现细节！✨
