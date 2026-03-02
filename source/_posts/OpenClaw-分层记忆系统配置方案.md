---
title: OpenClaw 分层记忆系统配置方案
date: 2026-03-02 22:08:00
updated: 2026-03-02 22:17:00
tags: [openclaw]
categories: [技术]
---
# OpenClaw 分层记忆系统配置方案

## 一、目录结构
```
# 在 workspace 目录下创建
mkdir -p memory/archive
touch MEMORY.md HEARTBEAT.md
```

## 二、核心文件模板

1. MEMORY.md（长期记忆库）
```
# Long-Term Memory

> 只写入没有它会犯错的信息。事件日志留在 daily files。
> 硬限制：80 行 / 5KB。超限时压缩旧条目。

## User Preferences

- **称呼**: 用户喜欢的称呼
- **生日**: YYYY-MM-DD
- **所在地**: 城市
- **喜欢的**: 重要偏好

## Active Projects

- **项目A**: 描述 + 状态
- **项目B**: 描述 + 状态

## Key Decisions

- [YYYY-MM-DD] 决策内容

## Important Resources

### API Keys (存储位置)
- **服务A**: `~/.config/xxx/credentials.json`

### Infrastructure
- **服务器A**: IP/域名信息

---
*Last updated: YYYY-MM-DD | Lines: ~X/80*
```

2. HEARTBEAT.md（心跳任务清单）

```

# 心跳检查任务列表

## 每日检查
- [ ] 检查是否有定时提醒需要发送
- [ ] 检查用户消息（如有重要消息需回复）
- [ ] 检查系统状态（如有异常需报告）
- [ ] 检查定时任务状态（是否有异常）

## 定时任务支持
保持此文件非空，确保定时任务正常执行
```
三、Cron 任务配置

添加以下定时任务（使用 openclaw cron add 或编辑配置文件）：

任务 1：记忆同步（每 4 小时）
```
{
  "name": "memory-sync",
  "enabled": true,
  "schedule": {
    "kind": "cron",
    "expr": "0 10,14,18,22 * * *",
    "tz": "Asia/Shanghai"
  },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "【记忆同步任务】\n\n1. 获取过去4小时的活跃会话（跳过 isolated）\n2. 过滤：消息数 < 2 的跳过，已记录的跳过\n3. 读取会话内容，提取关键信息\n4. 生成摘要（每个会话 3-10 条要点）\n5. 追加到 memory/YYYY-MM-DD.md\n6. 运行 `openclaw memory index` 重建索引\n7. 完成后回复 ANNOUNCE_SKIP"
  },
  "delivery": { "mode": "announce" }
}
```
任务 2：记忆整理（每天凌晨 3 点）
```
{
  "name": "memory-tidy",
  "enabled": true,
  "schedule": {
    "kind": "cron",
    "expr": "0 3 * * *",
    "tz": "Asia/Shanghai"
  },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "【记忆整理任务】\n\n1. 列出 memory/ 最近7天的日记文件\n2. 读取 MEMORY.md，识别重要信息\n3. 四维验证筛选：\n   - 没有它我会犯错？\n   - 未来多次用得上？\n   - 单独看能看懂？\n   - MEMORY.md 没有重复？\n4. 备份原文件到 memory/archive/\n5. 添加新内容，保持 80 行上限\n6. 运行 `openclaw memory index`\n7. 汇报结果"
  },
  "delivery": { "mode": "announce" }
}
```
四、向量化配置

1. 检查 embedding 配置
```
# 查看当前记忆搜索状态
openclaw memory status

2. 配置 embedding 模型（在 openclaw.json 中）

{
  "memory": {
    "embeddings": {
      "provider": "openai",
      "model": "gemini-embedding-001",
      "apiKey": "你的 Google AI Studio Key (AIzaSy...)"
    }
  }
}
```
免费 Key 获取: https://aistudio.google.com/app/apikey

五、使用方式

对话中搜索记忆

直接问 AI：

>"我之前说过要备份什么吗？"
>"我那个服务器 IP 是多少？"


AI 会自动调用 openclaw memory search 搜索。

手动搜索
```
openclaw memory search "关键词"
```
六、注意事项

1. sessionTarget 必须用 "isolated" - 避免阻塞主会话
2. 首次使用需手动创建 memory 目录 - 否则索引会失败
3. Google embedding 有免费额度 - 个人使用完全足够
4. MEMORY.md 保持精简 - 日常细节留在日记，只提炼关键知识