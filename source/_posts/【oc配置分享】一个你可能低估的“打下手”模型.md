---
title: 【oc配置分享】一个你可能低估的“打下手”模型
date: 2026-03-04 22:26:00
updated: 2026-03-04 23:54:00
tags: []
categories: []
---
>本文首发于Linux.do和我的blog~[泠诗的小窝](https://lingshichat.top)

# 引言
大家好呀，这是我来L站的第一个帖子~
其实在用邀请码写小作文的时候就写了想看社区里的佬们如何各种折腾ai的，然后也想结合自己的实践经验分享一下给各位佬友们
可能有些许不妥之处，还望大家批评指正QAQ，毕竟我只是个小趴菜
以下分享是根据我个人使用经验来配置的
# 一、opencode模型配置
其实看佬友们都在分享cc和cx比较多，那我蛮钟爱oc的其实，因为穷用不起claude呜呜呜呜cc只能稍微用用，codex觉得现阶段刚出不太完善
更主要的原因是，oc是可以**自由配置自己手头上已有的模型**！不局限于claude和codex
众所周知，oc有一个特性：sub-agent，也就是子代理，这个sub-agent可以用来**检索外网数据、检索代码库、调研方案、编写一些不痛不痒的文档，为main-agent（也就是主代理，比如oc用的比较多的Sisyphus）分担工作压力，同时也降低对应main-agent的token消耗**，以下是一些针对oc的模型配置：
| Agent（角色） | 使用模型 | 选择理由 |
|---------------|----------|----------|
| atlas（总调度） | Claude Opus 4.6 | 顶级推理，处理复杂多代理编排 |
| metis（方案预审） | Gemini 3.1 Pro | 多模态推理，挖掘隐藏需求 |
| prometheus（设计评审） | Gemini 3.1 Pro | 视觉/架构/安全审查能力强 |
| hephaestus（建造者） | GPT-5.3 Codex | 代码专用，确定性输出（temperature: false） |
| sisyphus（主力） | GPT-5.3 Codex | 与建造者一致，使用 Responses API 变体 |
| sisyphus-junior（辅助） | Step 3.5 Flash | 低成本处理简单重复任务 |
| explore（代码探索） | Step 3.5 Flash | 快速、便宜，用于文件结构/模式搜索 |
| librarian（外部检索） | Step 3.5 Flash | 高频查询成本优化 |
| oracle（咨询） | Step 3.5 Flash | 快速技术问答，低延迟 |
| frontend-ui-ux-engineer（前端） | Gemini 3.1 Pro | 原生多模态（图片/设计稿理解） |
| multimodal-looker（媒体分析） | Gemini 3 Flash | 轻量级图像/视频/PDF 分析 |
| document-writer（文档） | MiniMax M2.5 | 100 万 token 上下文，长文档生成 |
| momus（计划评审） | Kimi K2.5 | 性价比高，评估计划完整性 |
但是我日常使用最多的，还是Sisyphus的codex以及一堆sub-agent调用的step-3.5-flash
# 二、sub-agent为何选择step-3.5-flash？
有人说，明明现在codex基本人人都有，价格低廉甚至可以白嫖，为什么不直接把codex设为各种sub-agent呢？
那看下面这个gif你就知道缘由了：
![step-3.5-flash.gif](https://lingshichat.s3.bitiful.net/1772637413182_step-3.5-flash.gif)
怎么样，是不是被这个吐字速度震惊啦，我知道站内有佬友们对step-3.5-flash这个模型的评测，可大部分都没有真正正视这个模型
step-3.5-flash是阶跃星辰推出的一款推理模型，专为对复杂任务的分解、计划，可快速可靠地调用工具执行任务，胜任逻辑推理、数学、软件工程、深度研究等各种复杂任务。上下文长度为256K，官方定价为百万token 2.1r，定价参考链接：https://platform.stepfun.com/docs/zh/pricing/details
而且目前在openrouter是可以免费调用的：https://openrouter.ai/stepfun/step-3.5-flash:free
而且对小龙虾的支持也不错~有小龙虾的佬友们也可以去试试~
# 三、oc缓存命中率低？
这里分享一下对应的配置文件和插件~是在之前南风大佬rc站的opencode说明文档的基础上配置的：[戳此下载](https://lingshichat.s3.bitiful.net/oc%E9%85%8D%E7%BD%AE%E4%B8%8E%E6%8F%92%E4%BB%B6.zip?no-wait=on)
# 尾声
佬友们如果有更多的问题欢迎在下面交流QAQ，我也只是个小趴菜，如果有错误请不吝指正
后续还有openclaw飞书插件相关技能分享、openclaw原版webui替换计划也在开坑ing——