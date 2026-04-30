---
version: 2.0.0
lastUpdated: 2026-04-29
---


# 为什么是 Ornn?

如果你来这里是想找一个面向人类的技能 marketplace,你会失望。如果你来这里是想找一个 agent 在调用的 substrate,这就是。

## Ornn 跟其他产品的根本区别

产品是被 **AI agent** 消费的 —— 不是被人类逛 catalogue 时点开的。这个区别决定了每一个设计决策:

- **API 工效优先于 discovery UX。** 当消费者是 Claude / GPT / Gemini 调用时,稳定且强类型的 schema 比一张漂亮的 hero 图重要得多。
- **Model-agnostic。** 技能是可移植的 artifact。任何能 pull 文件 + 注入上下文的 agent runtime 都能消费 Ornn 技能 —— 无模型锁定。
- **生命周期,不是目录。** 列出技能是无聊的部分。让一个 agent 自己 build 新技能、审计、分享给特定 user / org、关联到 GitHub source、把更新同步回来、长期跟踪执行 analytics —— 这才是生命周期。

## 你实际拿到的

| 层 | 做什么 |
|---|---|
| **Registry + CRUD** | 版本化、经过校验的技能。按 GUID 或名字 pull。Diff 两个版本。废弃 / 硬删单个非最新版本。 |
| **搜索 + facet** | 关键词 + 语义。每 tab 专属过滤器:tags / authors / services / grant-orgs / grant-users。Visibility-scoped 到 caller 实际能看到的范围。 |
| **AI 生成 (SSE)** | 从 prompt、源代码或 OpenAPI spec 生成技能 —— 流式,agent 边收边处理。 |
| **GitHub link + sync** | 把 Ornn 技能关联到 public GitHub 文件夹。同步时先 dry-run diff,用户确认,再 bump 版本。 |
| **沙箱试验场** | 安装前端到端运行技能:chrono-sandbox 跑代码,你的 LLM 看结果。 |
| **审计作为风险标签** | 每个技能带 verdict(`green` / `yellow` / `red`)。审计按需触发,从不阻塞分享。技能翻 risky 时,消费者收到通知。 |
| **NyxID 身份 + per-skill ACL** | API 边缘的真实 user / org 身份。ACL 是真 ACL,不是君子协议。 |
| **分析 + 通知** | Pull 数(api / web / playground 拆分)、执行 telemetry、audit 扇出通知。 |

## 跟你今天可能在用的方案对比

你大概率已经有 *某个* 地方在放技能文件 —— 一个 marketplace、一个 Vercel 风格的 directory、或者一个 GitHub 仓库。下面是 Ornn 在哪里开始物有所值。

### vs. Vercel `skills.sh` 这类浏览式 directory

精致的 directory 擅长面向人类的 discovery,不是为 agent 的 runtime loop 设计的。Ornn 填的是 *人类决定要用某个技能之后* 的空隙:

- **Programmatic 列表 + 安装。** 关键词 + 语义搜索一次 HTTP 调用搞定。`GET /skills/:idOrName/json` 返回每个文件 inline,agent 立刻就能注入上下文 —— 不用 GitHub 转跳、不用 raw-URL parsing、不用一文件一 fetch。
- **Programmatic 发布。** SSE 流式 AI 生成允许 agent 在自己 loop 里生成技能、校验、上传。
- **Identity-aware 分享。** 真 ACL(私有 / 分享给用户 / 分享给组织 / 公开),由 NyxID 背书 —— 不是君子协议式的「私有 listing」。
- **审计 verdict 是结构化数据。** 不是星级或 4.8/5 评分 —— 是每个版本的 `green` / `yellow` / `red` verdict,带 `audit.risky_for_consumer` 自动扇出通知。
- **执行 telemetry。** Per-skill pull 数(api / web / playground 拆分)、延迟、成功率。

### vs. SkillMP 这类 marketplace

Marketplace 优化三件事:**discovery**、**变现**、**社交背书**。Ornn 优化 **runtime 操作**:

- Search → pull → execute 各一次 HTTP 调用。Agent 不离开自己的 loop。
- Per-skill ACL 通过 NyxID 解析 —— 把私有技能分享给 `org_xyz` 意味着 `org_xyz` 里所有人都能看到;别人都不行。
- 审计 verdict 是 audit pipeline 产出的,不是用户投票出来的。Owner 收到 `audit.completed`;消费者自动收到 `audit.risky_for_consumer`。
- AI-native 发布 —— 从 prompt 生成、对照 format spec 校验、上传,全在代码里。

如果你想 *卖* 技能,marketplace 是对的形态。如果你想让 agent 在 runtime *用* 技能,Ornn 是对的形态。

### vs. 直接用 GitHub

GitHub 是代码托管。它存文件,提供 `gh search` + `curl raw.githubusercontent.com`。够用 —— 直到下面任意一条变成真:

- **多租户。** 有些技能只该让某个组织看到,别的组织看不到。GitHub 的解法是付每仓私有费或开 org;Ornn 的解法是 per-skill ACL。
- **混合信任级别。** 一些技能 public,一些 team 内部私有,一些只跟一个外部合作方分享。GitHub 强迫你拆成不同 repo / org;Ornn 在每个技能上翻一个开关就行。
- **审计 + 通知。** 你想在技能变成 risky 时自动告诉消费者。GitHub 不做;Ornn 把它做成头等流程。
- **Programmatic agent loop。** GitHub 路径是 `gh api` + raw-URL 解析 + 自己 cache。Ornn 路径是每个动词一次调用,对应稳定 schema。
- **安装前先沙箱跑。** Ornn 的试验场在 chrono-sandbox 里跑技能;GitHub 不行。
- **针对技能有意义的 telemetry。** Ornn 给 pull 数按来源拆分(api / web / playground)、执行成功率;GitHub 给 star 和 clone。

**两者并不互斥。** `POST /skills/pull` 把 public GitHub 文件夹导入成 Ornn 技能。`PUT /skills/:id/source` 把已存在的 Ornn 技能关联到 GitHub 文件夹。`POST /skills/:id/refresh`(带 dry-run 预览)把 GitHub 上的更新同步回 Ornn —— 团队保留 git 作为技能正文的 source-of-truth,Ornn 处理分发 + ACL + 审计 + telemetry。

## Ornn **不是**

- 不是面向人类的技能 marketplace。没有排行榜、没有社交排序、没有「本周热门」feed。
- 不绑定特定 agent runtime。技能不是 Claude-only 或 GPT-only。
- 不是 git 的替代品。我们不打算做代码托管 —— 想让 git 继续做 source-of-truth,就把技能关联到 GitHub 文件夹。
- 不是 runtime 守护栏。审计是被动标签,不是 runtime 阻塞。需要 runtime 安全请在 agent 上层叠 Lakera / LLM Guard / NeMo。

## 接下来去哪

- **Skill owner / 管理员:** [Quick Start → Web Users](/docs?section=qs-web-user)。
- **Agent 开发者:** [Quick Start → Agent Manual](/docs?section=qs-agent-manual)。完整的操作手册 + per-endpoint API 参考以 Ornn system skill 形式发布(`ornn-agent-manual-cli` 给 NyxID CLI transport,`ornn-agent-manual-http` 给直接 HTTPS)—— 拉适合你环境的那一个。
