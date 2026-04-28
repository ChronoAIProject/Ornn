---
version: 1.0.0
lastUpdated: 2026-04-28
---


# 为什么是 Ornn

Ornn 是 AI agent 调用的 API 层，用来管理它自己的技能生命周期：搜索 → 拉取 → 安装 → 执行 → 构建 → 上传 → 分享 —— 每一个 agent 想对一个 skill 做的事情，都是一次 HTTP / MCP 调用。最接近的类比是 **npm registry + npm CLI 融为一体，model-agnostic**。

这一页只想说清楚一件事：Ornn 是给谁用的、解决谁的问题。如果你来这里是想找一个给人浏览的 skill marketplace，你会失望；如果你来这里是想找一个 agent 真正在调用的底座，那就是它。

## 客户是 agent 开发者

产品是被 **AI agent** 消费的 —— 不是被人浏览目录消费的。Web UI 当然也存在，但它是次要 surface，给 skill owner 和平台管理员管理自己工作的地方。主产品是 API 契约。

这个区别会贯穿到所有设计决策里：

- **API 工效优先于发现 UX。** 一个稳定、强类型的 schema，比一张漂亮的 hero banner 更重要 —— 因为消费者是 Claude / GPT / Gemini 的一次调用。
- **Model-agnostic。** Skill 是可移植的产物（一份 `SKILL.md` + 可选脚本 + 元数据）。任何能拉文件并注入上下文的 agent runtime 都能消费 Ornn skill。
- **生命周期，不是目录。** 列 skill 是无聊的部分。让 agent 构建一个新 skill、审计它、和另一个用户/组织共享、一段时间后看执行分析数据 —— 这才是生命周期。

## 你真正得到什么

| 层 | 能力 |
|---|---|
| **Registry + CRUD** | Skill 是版本化的、可校验的、有存储。按 GUID 或 kebab-case 名字拉。两个版本 diff。可以 deprecate 一个版本而不删除它。 |
| **Search** | Keyword + semantic search，跨公开 + 调用方可见的切片。通过 NyxID services 实现 system-skill filter。 |
| **AI 生成** | 从 prompt、源码、OpenAPI spec 生成新 skill。SSE 流式返回。 |
| **沙箱试验场** | 安装前完整试用一个 skill：chrono-sandbox 跑代码，你的 LLM 看到结果。 |
| **审计作为风险标签** | 每个 skill 都有 verdict（`green` / `yellow` / `red`）。审计按需运行，永远不会阻塞分享；变成 `yellow` / `red` 时使用者会收到通知。 |
| **NyxID 身份** | API 边缘有真实的 org / 用户身份。Per-skill ACL 是真 ACL，不是 honor system。 |
| **分析数据** | 每个 skill 版本的拉取数（按 api / web / playground 来源拆分）和执行 telemetry。 |

## Model-agnostic by design

Ornn 不绑定特定 LLM 厂商。Skill 由你指向 API 的那个 agent 拉取并执行。Ornn 内部使用 NyxID LLM gateway 处理 skill 生成 + 审计，但消费 skill 的 agent 自由选择 Claude / GPT / Gemini / 自研 runtime。Skill 内容是可移植的文本 + 脚本。

## Ornn **不是**

- 不是给人逛的 skill marketplace。没有排行榜，没有社交评分，没有"本周热门"feed。
- 不绑定任何 agent runtime。Skill 不是 Claude-only / GPT-only。
- 不是 git 替代品。我们不打算做 code host。如果你想用版本控制管理 skill 源码，就在 git 里管，然后用 `POST /skills/pull` 导入即可。
- 不是 runtime 防护栏。审计是标签，不是 runtime block。要 runtime 安全请在你的 agent 上叠 Lakera / LLM Guard / NeMo。

## 接下来去哪儿

- **快速开始 → Web 用户快速入门**：GUI 操作向导。
- **Agent 开发者**：操作手册 + 完整 API 参考已经合并成一个 Ornn 系统技能 —— `ornn-agent-manual`。用 `GET /api/v1/skills/ornn-agent-manual/json` 拉一份，把 `SKILL.md`（工作流 + 用例）和 `references/api-reference.md`（每个端点的细节 + 错误码） 注入你 agent 的 system context 即可。
- **技术参考 → 系统架构 / 外部集成**：了解部署层面各个组件之间的关系。
