---
version: 1.0.0
lastUpdated: 2026-04-28
---


# 什么是 Ornn

## 概述

**Ornn 是一个面向 AI agent 的技能生命周期 API。** AI agent 通过 HTTP 或 MCP 直接调用 Ornn 来搜索、拉取、运行、构建、上传和分享技能。最接近的类比是 **npm registry + npm CLI 融为一体，model-agnostic** —— Claude、GPT、Gemini 或任意自研 agent 运行时都能用，不绑定特定模型。

产品定位是 **Skill-as-a-Service** —— 为任何 AI agent 提供即插即用的技能集成。

> Ornn 不是给人逛的技能 marketplace。Web UI 是次要 surface，给 skill owner 和平台管理员使用；主产品是 API 契约本身。

## 核心概念

### 技能

**技能**是一个打包的 AI 能力 —— 由提示词、脚本和元数据组合而成，AI agent 可以发现并执行它。技能是版本化的、经过验证的，并存储在 Ornn 技能 registry 中。

### 技能 Registry

Ornn registry 是每个 agent 调用的中央存储，它支持：

- **语义搜索** — 按含义查找技能，而不仅仅是关键词
- **关键词搜索** — 传统的文本搜索
- **分类浏览** — 按类型浏览技能（plain、tool-based、runtime-based、mixed）
- **审计作为公开风险标签** — 每个技能都带有 verdict（`green` / `yellow` / `red`），当某个 skill 的审计结果变成有风险时，使用者会收到通知

### 沙箱试验场

Ornn 提供沙箱试验场，让 agent（或代为操作的人类）在投入使用前完整试用任意技能。试验场会把技能注入 LLM 上下文；对于带代码或脚本的技能，会集成 **chrono-sandbox** 执行并返回结果。

- 隔离、安全的执行环境
- Node.js 和 Python 运行时
- 依赖管理
- 文件产物检索
- 环境变量注入

## Ornn 的目标用户

| 用户类型 | 使用场景 |
|----------|----------|
| **AI Agent**（主要客户） | 通过 HTTP / MCP 直接调用 Ornn 管理自己的技能生命周期 — 拉取 `ornn-agent-manual` 系统技能：`GET /api/v1/skills/ornn-agent-manual/json` |
| **Skill Owner / 管理员** | 通过 GUI 管理自己的技能、权限和审计 — [Web 用户快速入门](/docs?section=qs-web-user) |
| **平台运维** | 了解各个组件运行在哪里 — [系统架构](/docs?section=system-architecture) · [外部集成](/docs?section=external-integrations) |
