---
name: ornn-agent-manual
description: 面向 AI agent 的 Ornn 技能生命周期 API 操作手册。以 skill 形式装载 —— 一旦安装，宿主 agent 即可通过 NyxID CLI 完成 skill 的搜索 / 拉取 / 执行 / 构建 / 上传 / 分享，无需额外配置。Ornn 与 agent 的权威契约。
metadata:
  category: plain
  tags:
    - ornn
    - agent
    - 手册
    - skill-lifecycle
---

# Agent 操作手册

> **请将本文档完整粘贴到 AI agent 的 system context 中。** 它本身就是一份 Ornn skill（`category: plain`）—— 上方 `SKILL.md` frontmatter + 下方正文构成整份 skill。一旦加载，agent 即可通过 `nyxid` CLI 完整操作 Ornn 的所有能力 —— 发现 skill、拉 skill、执行 skill、创建 skill、管理自己的 skill 库、参与分享流程。不需要 SDK，不需要 MCP，只需要 CLI。
>
> Ornn 的产品是 **面向 AI agent 的 Skill-as-a-Service**。Skill 是打包好的 AI 能力（一份 `SKILL.md` prompt + 可选脚本 + YAML 元数据），任何 agent 都能拉下来执行。本手册即 Ornn 与 agent 之间的契约。

## §1. 前置条件

本手册中的每一次 API 调用都通过 **NyxID CLI** (`nyxid`) 完成。NyxID 在 Ornn 之前一层：负责 OAuth 登录、token 刷新，并把已认证的 HTTP 请求转发到 Ornn。你不会直接和 Ornn 通信。

### 1.1 安装 NyxID CLI

从 NyxID releases 页面下载 `nyxid` 二进制，放到 `$PATH` 中。验证：

```bash
nyxid --version
```

### 1.2 登录

```bash
nyxid login
```

会打开浏览器走 OAuth authorization code 流程。成功后 token 存在 `~/.nyxid/`，跨调用持久化。Token 自动续期，几乎不用再次登录。

### 1.3 验证身份和权限

```bash
nyxid whoami
```

预期输出包含 `user_id`、`email`、`roles`、`permissions`。任何非平凡的 Ornn 操作都至少需要这些权限：

- `ornn:skill:read`
- `ornn:skill:create`
- `ornn:skill:build`
- `ornn:playground:use`

如果某个权限缺失，需要由你的 NyxID 管理员授予对应角色（通常是 `ornn-user`）。否则 §3 / §6 中的每个调用都会返回 `403 FORBIDDEN`，`error.code = "FORBIDDEN"`。

### 1.4 发现 Ornn 服务

```bash
nyxid proxy discover --output json
```

返回当前用户能通过 NyxID 访问的所有服务。确认其中有一项 `"slug": "ornn"`。本手册之后的所有 Ornn 调用都使用这个 slug。

---

## §2. 核心工作流

Ornn 暴露约 50 个端点，但 agent 真正用到的几乎都浓缩为以下三种工作流。先吃透这部分；§3 / §6 只是补充每个端点的细节。

### 2.1 发现 → 拉取 → 执行

**意图：** 你需要某个能力但本地没有，Ornn 上可能已经有现成的 skill。

| 步骤 | 操作 | API |
|------|------|-----|
| 1 | 用关键词或语义搜索找候选 skill | `GET /api/v1/skill-search` |
| 2 | 取回 skill 详情 + 文件内容 | `GET /api/v1/skills/:idOrName/json` |
| 3 | 在自己的 agent 里执行 skill 内的脚本 / prompt | （你自己的代码）|

`/json` 端点比 `/skills/:idOrName` 更适合 agent —— 它直接返回内联文件内容，不需要再下载 ZIP。Ornn 一次调用就能给你能用的全部内容。

### 2.2 构建 → 测试 → 分享 → 审计标签

**意图：** 构建一个 skill 之后先在 playground 交互测试，向某个用户、组织或者公开范围开放访问，然后让审计结果作为风险标签和通知传播——不再作为分享的"门"。

| 步骤 | 操作 | API |
|------|------|-----|
| 1 | 在 playground 用真实输入测试 | `POST /api/v1/playground/chat` (SSE) |
| 2 | 作者更新分享名单（这一步就是"分享"） | `PUT /api/v1/skills/:id/permissions` |
| 3 | 作者（或任何使用者）对当前版本发起一次审计 | `POST /api/v1/skills/:idOrName/audit` |
| 4 | 通过通知流跟踪审计结论 | `GET /api/v1/notifications` |

分享是**无条件的**。**没有单独的 share 端点** —— 分享是 `PUT /skills/:id/permissions` 的副作用。后端按调用方的请求原样写入名单，没有审计 gate，没有豁免，没有审核者。

审计是**风险标签**，与分享解耦：

- 从未审计过的 skill 在 UI/API 中显示为 *尚未审计*。
- 一次完成的审计会输出 verdict —— `green`（低风险）/ `yellow`（有发现）/ `red`（严重发现），用于装饰 skill。
- 审计完成时，**作者**总是会收到通知；当 verdict 为 `yellow` 或 `red`，**所有使用者**（`sharedWithUsers` 全员，外加 `sharedWithOrgs` 中所有组织的成员）也会收到通知，自行决定是否继续使用。

### 2.3 演化：发版 → 弃用 → 重新审计

**意图：** Skill 已经发布，需要更新内容并保留历史可回溯。

| 步骤 | 操作 | API |
|------|------|-----|
| 1 | 重打包 ZIP（在 SKILL.md frontmatter 里更新 `version`），PUT 到同一个 skill | `PUT /api/v1/skills/:id` |
| 2 | （可选）将旧版本标记为废弃，留个 note | `PATCH /api/v1/skills/:idOrName/versions/:version` |
| 3 | 对新的 latest 版本再跑一次审计（如果想分享） | `POST /api/v1/skills/:idOrName/audit` |

每次发版都会创建一条不可变的版本行；旧版本依然可读，agent 可通过 `?version=` 显式 pin。

---

## §3. 完整 API 参考

每个 Ornn 端点都满足以下约定：

- 都在 `/api/v1/...` 前缀下（后端把 `apiApp` 挂在 `/api/v1`）
- 通过 CLI 调用：`nyxid proxy request ornn <path> --method <VERB> [--data <body>] [--stream]`
- 返回 JSON envelope `{ "data": <T> | null, "error": { "code": string, "message": string } | null }`，SSE 流（§5）除外
- 除非标注了 "Anonymous"，都需要已登录的 NyxID 会话

表中命令缩写：
- `G <path>` = `--method GET`
- `P <path>` = `--method POST`
- `PUT <path>` = `--method PUT`
- `PATCH <path>` = `--method PATCH`
- `D <path>` = `--method DELETE`

### 3.1 Skills CRUD

| Method | Path | 权限 / 鉴权 | 用途 |
|--------|------|-------------|------|
| POST | `/api/v1/skills` | `ornn:skill:create` | 上传新 skill（body 是 ZIP 二进制） |
| POST | `/api/v1/skills/pull` | `ornn:skill:create` | 从公开 GitHub 仓库导入 |
| POST | `/api/v1/skills/:id/refresh` | `ornn:skill:update` + 作者/管理员 | 用导入的仓库的当前 HEAD 重新拉取 |
| GET | `/api/v1/skills/:idOrName` | 可选 | 拿元数据 + `presignedPackageUrl` 用于下载 ZIP |
| GET | `/api/v1/skills/:idOrName/json` | `ornn:skill:read` | 整个包以 `{ files: { path: content } }` 返回 —— **agent 推荐用这个** |
| GET | `/api/v1/skills/:idOrName/versions` | 可选 | 列出所有发布过的版本，按时间倒序 |
| GET | `/api/v1/skills/:idOrName/versions/:from/diff/:to` | 可选 | 两个版本之间的结构化文件级 diff |
| PUT | `/api/v1/skills/:id` | `ornn:skill:update` + 作者/管理员 | 上传新版本（ZIP）或翻转 `isPrivate` |
| PUT | `/api/v1/skills/:id/permissions` | `ornn:skill:update` + 作者/管理员 | 替换分享名单（`sharedWithUsers`、`sharedWithOrgs`） |
| PATCH | `/api/v1/skills/:idOrName/versions/:version` | `ornn:skill:update` + 作者/管理员 | 切换某个版本的 deprecation 标志 |
| DELETE | `/api/v1/skills/:id` | `ornn:skill:delete` + 作者/管理员 | 硬删除整个 skill 及其所有版本 |
| DELETE | `/api/v1/skills/:idOrName/versions/:version` | `ornn:skill:delete` + 作者/管理员 | 删除单个非 latest 版本。Skill 上只剩一个版本时拒绝（请用上一行）；删除当前 latest 也拒绝（请先发新版）。 |

**几个重要输入：**

- `POST /skills` 接受 ZIP 二进制（`Content-Type: application/zip`）或 `multipart/form-data`。ZIP 必须包含恰好一个根文件夹，里面有 `SKILL.md`。Query `skip_validation=true` 可以跳过格式检查（慎用 —— registry 会乐于存进格式错误的包）。
- `POST /skills/pull` body：`{ "repo": "owner/name", "ref": "main", "path": "", "skip_validation": false }`。服务端 clone、zip、注册一条龙。
- `PUT /skills/:id` 用 JSON body `{ "isPrivate": false }` 仅翻转可见性，不动包内容。带 ZIP body 则发布新版本。
- `GET /skills/:idOrName` 接受 `?version=1.2` 来取特定版本，省略则取 latest。

### 3.2 Skills Search 与 Discovery

| Method | Path | 鉴权 | 用途 |
|--------|------|------|------|
| GET | `/api/v1/skill-search` | 可选 | 关键词或 LLM 重排序搜索（语义模式需登录） |
| GET | `/api/v1/skill-counts` | 可选 | Registry 各 tab 的计数（`public`、`mine`、`sharedWithMe`） |

**`/skill-search` 的 query 参数：**

| 参数 | 取值 | 说明 |
|------|------|------|
| `query` | string（最多 2000 字符） | 空 = 全部返回 |
| `mode` | `keyword`（默认） \| `semantic` | semantic 用 LLM 重排序 |
| `scope` | `public` \| `private` \| `mixed` \| `shared-with-me` \| `mine` | 默认值取决于是否登录 |
| `page`, `pageSize` | int（pageSize 1–100，默认 9） | offset 分页 |
| `model` | model id | 覆盖 semantic 模式默认 LLM |
| `systemFilter` | `any`（默认） \| `only` \| `exclude` | 过滤"系统 skill"（tag 匹配 NyxID 服务 slug） |
| `sharedWithOrgs`, `sharedWithUsers` | 逗号分隔的 ids | 按授权来源过滤（`scope=mine` 时） |
| `createdByAny` | 逗号分隔的 user_ids | 按作者过滤（管理员 / 目录用） |

### 3.3 Skills Generation *(SSE — 见 §5)*

| Method | Path | 权限 | 用途 |
|--------|------|------|------|
| POST | `/api/v1/skills/generate` | `ornn:skill:build` | 从自然语言 prompt 生成 |
| POST | `/api/v1/skills/generate/from-source` | `ornn:skill:build` | 分析源码生成（内联代码段或 GitHub 仓库 URL） |
| POST | `/api/v1/skills/generate/from-openapi` | `ornn:skill:build` | 从 OpenAPI 3 spec 生成 |

三个端点都流式返回事件直到生成完成。CLI 调用时加 `--stream`。

**Body 形态：**

```jsonc
// /generate — 单轮 prompt
{ "prompt": "Build a skill that converts CSV to JSON using csv-parse" }

// /generate — 多轮微调
{ "messages": [{ "role": "user", "content": "..." }, ...] }

// /generate/from-source
{
  "code": "<inline snippet>",              // 或者
  "repoUrl": "https://github.com/org/repo", // 二选一
  "path": "src/mymodule/index.ts",         // 可选，缩小扫描范围
  "framework": "express",                  // 给 generator 的提示
  "description": "extract a skill that ..."
}

// /generate/from-openapi
{
  "spec": "<OpenAPI YAML or JSON>",
  "endpoints": ["GET /users", "POST /users"], // 可选 allow-list
  "description": "generate a skill that ..."
}
```

`/generate` 也接受 `multipart/form-data`，包含 `prompt` 字段和可选的 `package` ZIP，用来在已有包基础上迭代。

### 3.4 Skill 格式 与 校验

| Method | Path | 鉴权 | 用途 |
|--------|------|------|------|
| GET | `/api/v1/skill-format/rules` | 匿名 | 取规范的格式规则（markdown） |
| POST | `/api/v1/skill-format/validate` | `ornn:skill:read` | 不上传，先把 ZIP 跟规则比对一次 |

`POST /validate` body = ZIP 二进制。响应：`{ "valid": true }` 或 `{ "valid": false, "violations": [{ rule, message }] }`。校验默认严格；上传时同一套规则也会执行，除非 `POST /skills` 加上 `skip_validation=true`。

### 3.5 Skills Audit

审计是 **作者主动触发**，不会自动产生。分享之前先跑一次 —— 分享门 (§3.6) 读最新一条 *completed* 审计，没有就拒绝。每次触发都会立刻插入一条新行，agent / UI 能看到 run 已经开始；LLM pipeline 在后台跑完后再原地更新这一行。

| Method | Path | 权限 / 鉴权 | 用途 |
|--------|------|-------------|------|
| GET  | `/api/v1/skills/:idOrName/audit?version=<v>` | 可见性同 `GET /skills/:idOrName` | 读最新一条 *completed* 审计（当前或指定版本）。还没有 completed 时返回 `null`。 |
| GET  | `/api/v1/skills/:idOrName/audit/history?version=<v>` | 可见性同 `GET /skills/:idOrName` | 列出审计 run，按时间倒序。不带 `?version=` 时返回所有版本；带就只看那个版本。**包含 running 行**。 |
| POST | `/api/v1/skills/:idOrName/audit` | 作者 OR `ornn:skill:admin` | 启动一次新审计。Body `{ "force"?: boolean }` —— `force=true` 跳过 30 天缓存。返回新行，状态 `running`。 |
| POST | `/api/v1/admin/skills/:idOrName/audit` | `ornn:skill:admin` | 同上，但跳过 ownership 检查（平台管理员万能键）。 |

**审计行的生命周期。** 每行有 `status`：

| Status | 含义 |
|--------|------|
| `running` | LLM pipeline 还在跑。完成前 `verdict` / `overallScore` / `scores` / `findings` 是占位值。 |
| `completed` | Pipeline 干净结束。`verdict` 是 `green` / `yellow` / `red`。`overallScore` 是 0–10 加权平均。 |
| `failed` | Pipeline 出错（拉存储失败、LLM parse 失败等）。`errorMessage` 给一个简要原因。这一行留在历史里，重新触发即可重试。 |

**审计缓存。** `force=false` 时，如果某条 `completed` 行的 `skillHash` 跟当前一致且不到 30 天，后端复用它，不再插新行。`force=true` 永远跑新的一次。

**Agent 的轮询模式。** 触发审计后每隔几秒去 `GET /audit/history?version=` 查，直到你这条 run 的 status 不再是 `running`。Web UI 是 3 秒一轮，跑完即停。

### 3.6 分享

**没有 `POST /skills/:idOrName/share` 端点，没有豁免流，也没有审核队列。** 分享是 `PUT /skills/:id/permissions` 的副作用（§3.1）。后端把请求里的 `isPrivate` / `sharedWithUsers` / `sharedWithOrgs` 原样存下来，响应形如：

```jsonc
{ "data": { "skill": <SkillDetail> }, "error": null }
```

没有审计校验，没有豁免列表，没有审核者。作者放进名单的人立刻获得访问；作者删掉的人立刻失去访问。

审计流水线（§3.5）独立运行，verdict 通过通知（§3.7）传达，永远不会阻塞分享。

### 3.7 Notifications

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/v1/notifications?unread=true&limit=50` | 列出你的通知 |
| GET | `/api/v1/notifications/unread-count` | 角标计数 |
| POST | `/api/v1/notifications/:id/read` | 标记某条已读 |
| POST | `/api/v1/notifications/mark-all-read` | 全部标记已读 |

全部要登录。目前会发出两类通知：

| 类别 | 接收者 | 触发 |
|------|--------|------|
| `audit.completed`            | Skill 作者 | 每次审计完成时发出。Body 区分 `green`（通过）和 `yellow`/`red`（有风险），并链到审计历史页。 |
| `audit.risky_for_consumer`   | `yellow`/`red` 审计 skill 的所有使用者 —— 即 `sharedWithUsers` 全员，外加每个 `sharedWithOrgs` 组织在 NyxID 里展开后的所有成员 | 同一次审计完成。`green` 时不发。 |

### 3.8 Analytics

两个端点，可见性都跟随 `GET /skills/:idOrName`：

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/v1/skills/:idOrName/analytics?window=7d\|30d\|all&version=<v>` | 执行汇总：调用次数、成功率、p50/p95/p99 延迟、独立用户数、top 错误码。不带 `version` 时聚合所有版本。 |
| GET | `/api/v1/skills/:idOrName/analytics/pulls?bucket=hour\|day\|month&from=<iso>&to=<iso>&version=<v>` | **拉取数**时间序列（skill 包被某处取走的次数）。返回 `{ items: [{ bucket, total, bySource: { api, web, playground } }, ...] }`。默认窗口：最近 7 天。 |

pulls 端点的 **`bySource` 枚举**：

| Source | 来源 |
|--------|------|
| `api`        | `GET /api/v1/skills/:idOrName/json` —— 程序化拉取（SDK / CLI / 外部 agent）。最接近北极星指标"被外部 agent 调用"。 |
| `web`        | `GET /api/v1/skills/:idOrName` —— 浏览器在详情页拿 presigned URL 后下载。 |
| `playground` | `POST /api/v1/playground/chat` 绑定到真实 skill 时。 |

匿名调用者只能看公开 skill 的分析数据。

### 3.9 Playground *(SSE — 见 §5)*

| Method | Path | 权限 | 用途 |
|--------|------|------|------|
| POST | `/api/v1/playground/chat` | `ornn:playground:use` | 注入 skill 后跑一次 chat；Ornn 负责 tool-use + sandbox 执行 |

Body：

```jsonc
{
  "messages": [
    { "role": "user", "content": "Translate: Hello" }
    // 后续轮次追加 role/content；带 toolCalls / toolCallId 时表示 LLM 用了内置工具。
  ],
  "skillId": "<guid or name>",               // 可选 —— 不带则是"裸"agent
  "envVars": { "API_KEY": "..." }            // 可选 —— runtime skill 注入到 sandbox 的环境变量
}
```

后端跑一个最多 5 轮的服务端 tool-use 循环：LLM 发 `function_call` 调 `execute_script` 或 `skill_search`，Ornn 自动执行（不用 client 批准），把结果喂回去，继续流式输出。从 agent 视角看就是一次调用，分块响应。

### 3.10 Admin

Admin 端点要 `ornn:admin:skill`（或 `ornn:admin:category`）权限。绝大部分 agent 永远不会调，这里列出仅为完整。

| Method | Path | 权限 | 用途 |
|--------|------|------|------|
| GET | `/api/v1/admin/stats` | `ornn:admin:skill` | 平台总览数据 |
| GET | `/api/v1/admin/activities` | `ornn:admin:skill` | 活动审计日志 |
| GET | `/api/v1/admin/users` | `ornn:admin:skill` | 用户目录 + 每用户计数 |
| GET | `/api/v1/admin/skills` | `ornn:admin:skill` | 全平台 skill 浏览 |
| DELETE | `/api/v1/admin/skills/:id` | `ornn:admin:skill` | 平台管理员删除 |
| GET | `/api/v1/admin/categories` | `ornn:admin:category` | 列分类 |
| POST | `/api/v1/admin/categories` | `ornn:admin:category` | 创建分类 |
| PUT | `/api/v1/admin/categories/:id` | `ornn:admin:category` | 更新分类 |
| DELETE | `/api/v1/admin/categories/:id` | `ornn:admin:category` | 删除分类 |
| GET | `/api/v1/admin/tags` | `ornn:admin:skill` | 列标签（`?type=predefined\|custom`） |
| POST | `/api/v1/admin/tags` | `ornn:admin:skill` | 创建自定义标签 |
| DELETE | `/api/v1/admin/tags/:id` | `ornn:admin:skill` | 删标签 |
| POST | `/api/v1/admin/skills/:idOrName/audit` | `ornn:admin:skill` | 强制重跑审计 |
| GET | `/api/v1/admin/settings` | `ornn:admin:skill` | 读平台级配置（审计豁免阈值等） |
| PATCH | `/api/v1/admin/settings` | `ornn:admin:skill` | 更新平台级配置。Body `{ "auditWaiverThreshold": <0-10> }`。 |

### 3.11 Me *(调用者身份和授权)*

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/v1/me` | 调用者快照：userId、email、displayName、roles、permissions |
| GET | `/api/v1/me/orgs` | 列出组织成员关系（仅 admin + member 角色） |
| GET | `/api/v1/me/orgs/:orgId` | 解析单个组织（即使你已经离开也能查） |
| GET | `/api/v1/me/nyxid-services` | 个人 + 组织继承的 NyxID 服务 —— 驱动"系统 skill"过滤 |
| GET | `/api/v1/me/skills/grants-summary` | 你分享出去的每个对象（用户/组织）拿到了多少个 skill |
| GET | `/api/v1/me/shared-skills/sources-summary` | 每个授权人（用户/组织）跟你分享了多少个 skill |
| POST | `/api/v1/activity/login` | 登录埋点（fire-and-forget） |
| POST | `/api/v1/activity/logout` | 登出埋点（fire-and-forget） |

### 3.12 Users *(目录查找)*

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/v1/users/search?q=<email-prefix>&limit=10` | 分享选择器的 typeahead |
| GET | `/api/v1/users/resolve?ids=a,b,c` | 批量把 user_ids 解析成 `{ email, displayName }` |

都需要登录。未知 id 静默丢弃（不 404）。

---

## §4. Auth 与 Envelope

### 4.1 响应 envelope

每个 JSON 响应都长这样：

```jsonc
{
  "data":  <T> | null,
  "error": { "code": string, "message": string } | null
}
```

- HTTP 2xx → `data` 有值，`error` 是 `null`。
- HTTP 4xx/5xx → `data` 是 `null`，`error` 有值。
- 流式响应（§5）**不**用这个 envelope —— 每个 SSE 事件本身是独立 JSON。

不要只看 `error === null` 判断成功，必须同时看 HTTP status。具体来说，500 响应可能被 proxy 注入不同 envelope，body 仍然是 `data: null`。

### 4.2 权限目录

每个写入或受保护的读取都需要这些权限之一。这些权限由 NyxID 根据角色发给调用者。

| 权限 | 谁有 | 解锁什么 |
|------|------|----------|
| `ornn:skill:read` | `ornn-user` | 读你能看到的私有 skill；拿 `/json` 视图 |
| `ornn:skill:create` | `ornn-user` | 上传新 skill（ZIP 或 GitHub 导入） |
| `ornn:skill:update` | `ornn-user` | 编辑自己的 skill（包、可见性、权限） |
| `ornn:skill:delete` | `ornn-user` | 删除自己的 skill |
| `ornn:skill:build` | `ornn-user` | 用 `/skills/generate*`（AI 生成） |
| `ornn:playground:use` | `ornn-user` | 用 `/playground/chat` |
| `ornn:admin:skill` | `ornn-admin` | 任意 skill 的管理操作；stats / activities / users / audit |
| `ornn:admin:category` | `ornn-admin` | 分类 CRUD |

典型角色映射：

| 角色 | 权限 |
|------|------|
| `ornn-user` | `skill:read`, `skill:create`, `skill:update`, `skill:delete`, `skill:build`, `playground:use` |
| `ornn-admin` | 全部 `ornn-user` + `admin:skill` + `admin:category` |

如果调用返回 `403 FORBIDDEN`，message 是 `"Missing permission: <perm>"`，先 `nyxid whoami` —— 这个权限不在你 session 里。

### 4.3 错误码

agent 应该处理的常见码：

| 码 | HTTP | 含义 |
|----|------|------|
| `AUTH_MISSING` | 401 | 没带凭证 |
| `FORBIDDEN` | 403 | 已登录，但权限不够或 ownership 检查失败 |
| `SKILL_NOT_FOUND` | 404 | Skill / 版本 / guid 不存在 |
| `VALIDATION_FAILED` | 400 | ZIP 格式校验失败（envelope 里有 `violations[]`） |
| `INVALID_BODY` | 400 | JSON 不合法或缺字段 |
| `PAYLOAD_TOO_LARGE` | 413 | ZIP 超过 `MAX_PACKAGE_SIZE_BYTES`（默认 50 MiB） |
| `CONFLICT` | 409 | 重复发布版本等 |
| `INTERNAL_ERROR` | 500 | 通用服务端失败 —— 退避重试 |

关联：每个响应都有 `X-Request-ID` header。报问题时一并附上 —— 它对应服务端日志行。

---

## §5. SSE 流式

两类端点不返回 JSON envelope，而是 Server-Sent Events 流：

- Skill 生成：`POST /api/v1/skills/generate`、`/generate/from-source`、`/generate/from-openapi`
- Playground chat：`POST /api/v1/playground/chat`

### 5.1 通过 CLI 消费流

加 `--stream`，CLI 把每个事件按行打到 stdout：

```bash
nyxid proxy request ornn "/api/v1/skills/generate" \
  --method POST \
  --data '{"prompt":"Create a skill that counts word frequencies in a file"}' \
  --stream
```

连接会保持几分钟。带校验重试的 LLM 生成可能 30–90 秒；多轮 sandbox 调用的 playground chat 可能超过两分钟。**不要给 client 设短超时**。

### 5.2 Skill 生成事件

由 `/skills/generate*` 发出：

| Event `type` | 含义 | 备注 |
|--------------|------|------|
| `generation_start` | 流打开，LLM 开始 | — |
| `token` | 增量内容块 | 把 `content` 字段拼接 |
| `generation_complete` | 完整生成的 skill | `raw` 是最终 payload |
| `validation_error` | 生成的 skill 没过格式校验 | `retrying: true` 表示服务端正在自动重试 |
| `error` | 致命流错误 | 连接关闭 |
| `keepalive` | 心跳 | 忽略 |

流的终止条件：要么 `generation_complete` 然后关闭，要么 `error`。

### 5.3 Playground chat 事件

由 `/playground/chat` 发出：

| Event `type` | 含义 |
|--------------|------|
| `text-delta` | 增量 assistant 文本 |
| `tool-call` | LLM 调了工具（`skill_search`、`execute_script`）；`toolCall` 有 `id`、`name`、`args` |
| `tool-result` | 工具完成；`toolCallId` 关联，`result` 是文本 |
| `file-output` | runtime skill 产出文件；`{ path, content, size, mimeType }` |
| `error` | 致命错误 |
| `finish` | 流结束；`finishReason` 已设 |
| `keepalive` | 心跳 |

正常 chat 以 `finish` 收尾。`tool-call` / `tool-result` 配对只出现在 runtime skill 或 agent 中途搜 registry 时。

---

## §6. 用例

每小节是一份完整 recipe —— 原样复制、替换显然要换的参数即可。

### 6.1 上传新 skill

**何时：** 你有本地目录（或生成的输出），想发布。

```bash
# 1. 整理包。ZIP 必须包含一个根文件夹，名字是 skill 名（kebab-case）。
#    里面：SKILL.md 必需。
#    my-skill/
#    ├── SKILL.md
#    └── scripts/ (可选)
cd ~/skills
zip -r my-skill.zip my-skill/

# 2. （可选）上传前校验。
nyxid proxy request ornn "/api/v1/skill-format/validate" \
  --method POST \
  --data @my-skill.zip \
  --header "Content-Type: application/zip" \
  --output json

# 3. 上传。默认私有，要改可见性见 §6.6。
nyxid proxy request ornn "/api/v1/skills" \
  --method POST \
  --data @my-skill.zip \
  --header "Content-Type: application/zip" \
  --output json
```

成功后 `data.guid` 是新 skill 的 uuid。要绕过上传时校验（极少用，只在历史包上）：path 加 `?skip_validation=true`。

### 6.2 下载（pull）一个 skill

**何时：** 你想本地跑 skill，或把它内容塞进 agent 上下文。

```bash
# 选项 A —— 整包 JSON（agent 推荐）：每个文件内联。
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/json" \
  --method GET --output json

# 选项 B —— 只要元数据 + presigned ZIP URL。只需要某个文件或想缓存到磁盘时合适。
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>" \
  --method GET --output json
# 然后用 curl 下 ZIP：
curl -o skill.zip "$(jq -r '.data.presignedPackageUrl' <<< "$RESPONSE")"
```

两个调用都可以加 `?version=<semver>` pin 到具体版本，不带就是 latest。

### 6.3 发布新版本

**何时：** 编辑了已有 skill，想发新版本。

```bash
# 在 SKILL.md frontmatter 里把 version 抬一档（如 1.2 → 1.3），重打包，
# PUT 到同一个 skill id。后端建一条不可变的新版本，latest 指针前进。
nyxid proxy request ornn "/api/v1/skills/<id>" \
  --method PUT \
  --data @my-skill.zip \
  --header "Content-Type: application/zip" \
  --output json
```

老版本仍然可以通过 `GET /skills/<idOrName>?version=<old>` 取到。没 pin 版本的消费者自动升级到新版。

### 6.4 把版本标记废弃

**何时：** 某个版本有已知问题但不想从历史里抹掉。

```bash
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/versions/1.2" \
  --method PATCH \
  --data '{"isDeprecated":true,"deprecationNote":"Breaks with axios >= 1.7; use 1.3+."}' \
  --output json
```

这个版本仍然在 `/versions` 列表里、仍可解析，但 `GET /skills/<idOrName>?version=1.2` 现在会返回带 deprecation banner 的 header。`isDeprecated: false` 取消废弃。

### 6.5 跑一次审计 *(只产出标签，不是分享门)*

**何时：** 发了新版本，想刷新公开的风险结论；或者使用者请你跑一次。**不会自动跑** —— 作者主动按 "Start Auditing" / 调这个端点。分享本身不依赖审计，这里纯粹是为了产出一个 verdict 标签和一条通知。

```bash
# 触发审计。立即返回，状态 "running"。
nyxid proxy request ornn "/api/v1/skills/<idOrName>/audit" \
  --method POST \
  --data '{"force":false}' \
  --output json

# 轮询直到完成（status 不再是 "running"）。
while true; do
  STATUS=$(nyxid proxy request ornn \
    "/api/v1/skills/<idOrName>/audit/history" \
    --method GET --output json \
    | jq -r '.data.items[0].status')
  [ "$STATUS" != "running" ] && break
  sleep 5
done

# 读结果。
nyxid proxy request ornn "/api/v1/skills/<idOrName>/audit" \
  --method GET --output json
```

加 `"force": true` 跳过 30 天缓存（即使刚跑过同一个 skill 也强制重跑）。

### 6.6 分享 skill *(无条件)*

**何时：** 想把权限放给某个用户、某个组织或公开。审计 verdict（如果有）只是参考标签，永远不会阻塞这次调用。

```bash
# 编辑名单，后端原样写入。
nyxid proxy request ornn "/api/v1/skills/<id>/permissions" \
  --method PUT \
  --data '{
    "isPrivate": true,
    "sharedWithUsers": ["user_abc"],
    "sharedWithOrgs": ["org_xyz"]
  }' \
  --output json
# 响应：{ "data": { "skill": <updated> }, "error": null }
```

要撤销，把目标从名单里去掉重新发同一个请求。要让 skill 公开，发 `"isPrivate": false`。要让它再次私有，发 `"isPrivate": true` + 清空 allow-list。

如果你想给刚刚分享出去的版本配一个新鲜的风险 verdict，触发一次审计（§6.5）。审计完成时作者会收到 `audit.completed` 通知；任何 `yellow`/`red` verdict 还会向所有使用者补发一条 `audit.risky_for_consumer` 通知。

### 6.6.1 删除非 latest 版本

**何时：** 老版本坏掉或被取代，想清理存储但不想删整个 skill。

```bash
# 不能删 skill 上仅剩的最后一个版本（请删整个 skill）
# 或当前 latest（请先发新版本）。
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/versions/<X.Y>" \
  --method DELETE --output json
```

### 6.7 用 AI 生成 skill *(SSE)*

**何时：** 需要全新 skill，想让 Ornn 的 LLM 搭个骨架。

```bash
# 单轮 prompt。
nyxid proxy request ornn "/api/v1/skills/generate" \
  --method POST \
  --data '{"prompt":"Create a plain skill that detects API keys, passwords, and PII in text"}' \
  --stream

# 多轮微调（复用上一次对话）。
nyxid proxy request ornn "/api/v1/skills/generate" \
  --method POST \
  --data '{
    "messages": [
      { "role": "user", "content": "Create a CSV-to-JSON skill" },
      { "role": "assistant", "content": "<previous generation>" },
      { "role": "user", "content": "Now use csv-parse, not papaparse" }
    ]
  }' \
  --stream
```

按 §5.2 消费流。看到 `generation_complete` 时，`event.raw` 就是成品 skill。重打包（§6.1）后上传。

### 6.8 从已有源码生成

**何时：** 已经有函数或模块在干这件事，只想把它打包成 skill。

```bash
nyxid proxy request ornn "/api/v1/skills/generate/from-source" \
  --method POST \
  --data '{
    "repoUrl": "https://github.com/someuser/some-repo",
    "path": "src/utils/summarizer.ts",
    "framework": "none",
    "description": "Package the summarize() function as a reusable skill"
  }' \
  --stream
```

或者把 `repoUrl` 换成 `code: "<inline>"` 传本地代码片段。

### 6.9 从 OpenAPI spec 生成

**何时：** 想把一个 HTTP API 暴露成 skill。Ornn 读 spec，生成调用对应端点的 skill。

```bash
SPEC=$(cat openapi.yaml | jq -Rs .)   # 把 YAML 编码为 JSON 字符串
nyxid proxy request ornn "/api/v1/skills/generate/from-openapi" \
  --method POST \
  --data "{\"spec\":$SPEC,\"endpoints\":[\"POST /v1/summary\"],\"description\":\"Wrap the summary endpoint\"}" \
  --stream
```

可选的 `endpoints` 数组限定 generator 覆盖的操作 —— 不传则覆盖 spec 里的所有操作。

### 6.10 上传前校验包

```bash
nyxid proxy request ornn "/api/v1/skill-format/validate" \
  --method POST \
  --data @my-skill.zip \
  --header "Content-Type: application/zip" \
  --output json
# → { "data": { "valid": true, "violations": [] }, "error": null }
```

便宜、安全、CI 里可以 always 调。`/skills` 上传前都跑一次。

### 6.11 在 playground 跑 skill *(SSE)*

**何时：** 想用真实输入端到端测试 skill，包括 sandbox 里的脚本执行。

```bash
nyxid proxy request ornn "/api/v1/playground/chat" \
  --method POST \
  --data '{
    "skillId": "<guid or name>",
    "messages": [
      { "role": "user", "content": "Translate: Hello, world." }
    ],
    "envVars": { "OPENAI_API_KEY": "..." }
  }' \
  --stream
```

按 §5.3 消费事件。runtime skill 要看 `tool-call` 中 `name: "execute_script"` + 配对的 `tool-result` —— 那就是 sandbox 跑的一次。

### 6.12 看 skill 的分析数据

```bash
# 跨所有版本的执行汇总。
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/analytics?window=30d" \
  --method GET --output json

# 同上，限定单个版本。
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/analytics?window=30d&version=1.2" \
  --method GET --output json

# 拉取数时间序列 —— 最近 7 天，按天分桶（默认）。
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/analytics/pulls?bucket=day" \
  --method GET --output json

# 自定义区间，按小时分桶，单一版本。
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/analytics/pulls?bucket=hour&from=2026-04-20T00:00:00Z&to=2026-04-21T00:00:00Z&version=1.2" \
  --method GET --output json
```

`window` 取值：`7d`、`30d`、`all`。`bucket` 取值：`hour`、`day`、`month`。匿名调用者只能看公开 skill。

### 6.13 比较两个版本

**何时：** 想知道 v1.2 到 v1.3 之间到底改了什么再去消费新版本。

```bash
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/versions/1.2/diff/1.3" \
  --method GET --output json
```

响应形态：`{ added: [...], removed: [...], modified: [{ path, before, after }] }`。文件级；修改文件的内容也都附在里面，可以本地渲染统一 diff。

### 6.14 处理通知

```bash
# 未读计数 —— 便宜，可以 poll 做角标。
nyxid proxy request ornn "/api/v1/notifications/unread-count" \
  --method GET --output json

# 取未读通知。
nyxid proxy request ornn "/api/v1/notifications?unread=true&limit=50" \
  --method GET --output json

# 标记某条已读。
nyxid proxy request ornn "/api/v1/notifications/<id>/read" \
  --method POST --data '{}' --output json

# 或者一次性清空。
nyxid proxy request ornn "/api/v1/notifications/mark-all-read" \
  --method POST --data '{}' --output json
```

两类审计事件（§3.7）以及针对你 skill 的管理员操作都会落到这里。

### 6.15 处理"审计风险"通知

**何时：** 收到了 `audit.risky_for_consumer` 通知 —— 别人分享给你的某个 skill 在新的审计中被打成 yellow/red，你想看一眼具体发现再决定要不要继续用。

```bash
# 1. 拿通知里的 deep-link（铃铛 + /notifications 页面会展示）。
#    链接指向 /skills/<idOrName>/audits?version=<v>。

# 2. 读那个版本的审计历史。
nyxid proxy request ornn "/api/v1/skills/<idOrName>/audit/history?version=<v>" \
  --method GET --output json

# 3. 标记这条通知已读。
nyxid proxy request ornn "/api/v1/notifications/<id>/read" \
  --method POST --data '{}' --output json
```

如果你决定不再使用，请作者把你从 `sharedWithUsers` 中移除，或退出共享给你的组织（§6.6）。使用者今天还不能自己撤销，得作者那边改。

---

## 附录 A —— 易踩的坑和约定

- **路径前缀是 `/api/v1/`** —— 本手册的每个示例都包含。丢掉 `/v1/` 后端直接 404，没有隐式重定向。
- **匿名调用很少。** `/skill-format/rules` 和公开版的 `/skill-search` 是主要的。其它都先 `nyxid login`。
- **ZIP 必须有且只有一个根文件夹**，名字跟 skill 名一致（`my-skill/SKILL.md`，不是把 `SKILL.md` 直接扔在 ZIP 根）。两种错都会被 validation 拒掉。
- **版本 pin** 到 `GET /skills/:idOrName[?version=]` 接受 `X.Y` semver —— 跟 `SKILL.md` frontmatter 里的 version 字符串匹配。
- **Skill 名 vs guid。** 大部分 GET 两者都接受，但写操作（`PUT /skills/:id`、`DELETE /skills/:id`）必须 guid。`POST /skills` 创建时就返回 guid，写操作时带上。
- **审计行 status**（`GET /audit/history` 可观察）：`running`、`completed`、`failed`。分享是无条件的，与审计 status 无关；审计 verdict 仅作信息标签，生命周期见 §3.5。
- **审计 verdict**：`green`、`yellow`、`red`。只有 `yellow`/`red` 会触发对所有使用者的 fan-out 通知（见 §3.7）。
- **读时 403 和写时 404 的差别。** 私有 skill 你看不到时会得到 404（不是 403）—— 防止泄露 skill 是否存在。写操作在 authed 但缺 ownership / admin 时返回 403。

---

## 附录 B —— 进一步资料

- `GET /api/v1/skill-format/rules` —— 规范的格式 spec，永远最新。
- `GET /api/v1/openapi.json` —— 自动生成的 OpenAPI 3 schema。本手册里的每个端点都在里面，包含完整的 Zod 推导出的请求 / 响应类型。
- 技术参考（本 docs 站点内）：**System Architecture** 看各个组件如何拼接，**External Integrations** 看 NyxID / chrono-sandbox / chrono-storage 的细节。
