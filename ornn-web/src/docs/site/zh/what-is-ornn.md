---
version: 2.0.0
lastUpdated: 2026-04-29
---


# 什么是 Ornn

## 一句话总结

**Ornn 是面向 AI agent 的技能生命周期 API。** 你的 AI agent 通过 HTTP 或 MCP 调用 Ornn,完成 search / pull / execute / build / upload / share / audit / version / link-to-GitHub / sync 等所有跟技能相关的操作 —— 每一步都是一次 API 调用。

最接近的类比:**npm registry + npm CLI 融为一体,model-agnostic。**

> 客户是 agent 开发者。Web UI 是次要 surface,给 skill owner 和平台管理员管理自己的工作用;主产品是 API 契约本身。

## 一个 Ornn 技能是什么

技能是可移植、版本化的 AI 能力打包:

- **`SKILL.md`** — 提示词正文 + YAML frontmatter(name、description、category、runtime、tags、version 等)。
- 可选 **`scripts/`** — 在 chrono-sandbox 里执行的代码。
- 可选 **`references/`**、**`assets/`** — 跟 `SKILL.md` 一起加载的辅助上下文。

技能是 runtime-agnostic 的 —— Claude、GPT、Gemini 或任意自研 agent loop 都能消费。格式就是文本 + 脚本,由 runtime 注入上下文(以及可选地执行)。

## 你能拿到什么

| 能力 | 做什么 |
|---|---|
| **Registry + CRUD** | 版本化的技能,每个版本不可变存储。按 GUID 或 kebab-case 名字 pull。客户端 diff 两个版本。废弃或硬删单个版本。 |
| **搜索** | 关键词 + 语义搜索,作用于 public + caller-visible 范围。每个 tab 都有专属过滤器:tags / authors / services / grant-orgs / grant-users。三个 facet 端点支持 chip 渲染。 |
| **AI 生成** | 从 prompt、源代码或 OpenAPI spec 生成全新技能 —— 全部 SSE 流式,agent 边产生边收到 token。 |
| **GitHub link + sync** | 把 Ornn 技能关联到 public GitHub 仓库的某个文件夹。从 GitHub 同步回 Ornn 时,先 dry-run 预览改动 + 用户确认,再 bump 版本。 |
| **沙箱试验场** | 安装前完整试用技能。chrono-sandbox 跑脚本,LLM 看结果。Server-side tool-use loop —— 一次 SSE 调用搞定。 |
| **审计作为被动风险标签** | 每个技能带 verdict(`green` / `yellow` / `red`)。审计由 owner 触发;verdict 只是装饰技能,从来不阻塞分享。技能 verdict 翻成 `yellow` / `red` 时,所有消费者会自动收到通知。 |
| **NyxID 身份 + ACL** | API 边缘有真实的 per-user / per-org 身份。Per-skill ACL:私有 / 分享给用户 / 分享给组织 / 公开。技能也能绑定到 NyxID service —— 绑定到 admin 层级会把技能标成 *system skill*(强制 public)。 |
| **分析** | Pull 数(api / web / playground 来源拆分),每个版本的执行 telemetry。 |
| **通知** | `audit.completed` 给 owner;`audit.risky_for_consumer` 在 verdict 翻 `yellow` / `red` 时扇出给消费者。 |

## Ornn 给谁用?

| 用户 | 从哪里开始 |
|---|---|
| **AI agents** *(主要客户)* — 通过 HTTP 或 MCP 调 Ornn | [Quick Start → Agent Manual](/docs?section=qs-agent-manual) |
| **Skill owner & 平台管理员** — 通过 GUI 管理技能、权限、审计 | [Quick Start → Web Users](/docs?section=qs-web-user) |
