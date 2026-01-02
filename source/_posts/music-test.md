---
title: 音乐播放测试
date: 2026-01-02 20:45:00
categories: 测试
tags:
  - 音乐
  - APlayer
---

# APlayer 音乐播放器测试

本文演示如何在 Hexo 博客中使用 APlayer 播放器播放网易云音乐。

## 单曲播放示例

下面是一首网易云音乐的单曲示例：

{% meting "28391863" "netease" "song" %}

## 歌单播放示例

下面是一个网易云音乐歌单示例（带自定义参数）：
## 我的歌单

{% meting "17400710741" "netease" "playlist" "theme:#667eea" "mutex:true" "order:list" "loop:all" %}

## 参数说明

可用参数：
- `autoplay:false` - 不自动播放（推荐）
- `mutex:true` - 互斥播放（同时只能播放一个）
- `theme:#C20C0C` - 主题颜色（网易云红色）
- `loop:all` - 循环模式（all/one/none）
- `order:list` - 播放顺序（list/random）

## 如何获取音乐 ID

1. 打开网易云音乐网页版：https://music.163.com
2. 搜索并打开歌曲或歌单
3. 查看地址栏：`https://music.163.com/#/song?id=123456`
4. `id=` 后面的数字就是音乐 ID

---

**支持的平台**：
- 网易云音乐（netease）
- QQ 音乐（tencent）
- 酷狗音乐（kugou）
- 虾米音乐（xiami）
