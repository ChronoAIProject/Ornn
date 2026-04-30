---
version: 1.0.0
lastUpdated: 2026-04-29
---


# 快速入门:Agent Manual

这一篇是给 **AI agent**(以及在搭 agent 的开发者)看的。如果你是想在 GUI 里管理技能的人,请看 [Web 用户快速入门](/docs?section=qs-web-user)。

## 什么是 agent manual

**Agent manual** 本身就是一个 Ornn 技能 —— agent 加载它来知道如何使用 Ornn 的操作契约。一旦 manual 进入上下文,host agent 就能端到端地做 search / pull / execute / build / upload / share / audit / link-to-GitHub / sync 等所有技能相关操作 —— 不需要再做模型微调,也不需要写定制 tool 绑定,就一个技能装进 agent 系统上下文。

Manual 按 transport 拆成两个变体 —— 选跟你 agent 调 Ornn 方式匹配的那个:

| 变体 | 技能名 | Transport |
|---|---|---|
| **NyxID CLI** | `ornn-agent-manual-cli` | `nyxid proxy request ornn-api …` |
| **Direct HTTPS** | `ornn-agent-manual-http` | `curl -H "Authorization: Bearer $TOKEN" …` |

两者都作为 **system skill** 发布,绑定到 `ornn-api` NyxID service —— 强制 public、平台级可发现、权威。

## 里面有什么

每个 manual 作为一个 Ornn 技能发布,包含两个文件:

- **`SKILL.md`** — agent 的 runtime 指令。装载每个常见操作的 workflow recipe:find or build a skill、update visibility、publish a new version、trigger an audit、view audit history、pull a different version、**diff two versions**、check analytics、bind to a NyxID service、**delete or deprecate a version**、delete a skill、find skills、pull notifications、**link to GitHub or trigger a sync** —— 13 个自包含 use case。
- **`references/api-reference.md`** — 详尽的 per-endpoint 目录。每个 method + path、request body schema、response 形态、每个 error code 加上对应 HTTP 映射、auth + authorization 规则。当 agent 需要某个 endpoint 完整契约时,把这个 pull 进上下文。

## 怎么访问

agent(或者搭 agent 的开发者)拉 manual 跟拉任何 Ornn 技能是一样的 —— 通过 registry。三种 fetch 路径,选适合你环境的那个:

### Option A — 通过 NyxID CLI *(`nyxid` 已装则首选)*

```bash
nyxid proxy request ornn-api \
  /api/v1/skills/ornn-agent-manual-cli/json --output json
```

### Option B — 直接 HTTPS,带 NyxID bearer token

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://ornn.chrono-ai.fun/api/v1/skills/ornn-agent-manual-http/json
```

### Option C — 匿名 *(system skill 永远 public)*

```bash
curl https://ornn.chrono-ai.fun/api/v1/skills/ornn-agent-manual-http/json
```

响应形态是 `{ data: { name, description, metadata, files: { "SKILL.md": "…", "references/api-reference.md": "…" } } }` —— 每个文件 inline。

## Agent 拿到 manual 之后做什么

agent runtime 应该:

1. **本地安装 manual**(如果有 skills 目录,例如 `~/.claude/skills/ornn-agent-manual-cli/`)。否则把内容保留在工作上下文里直到 session 结束。
2. **追加一条记录到 `~/.ornn/installed-skills.json`** —— 每个 Ornn 感知 agent 维护的跨 session 安装注册表。Schema:`{ name, ornnGuid, installedVersion, installedAt, localPath?, isPinned? }`。Manual 自身在 §0.5 documenting 这个契约。
3. **每次 Ornn 操作前重新检查更新** —— 列出版本和已装版本对比。覆写到新版本时同时 bump `installedVersion` + `installedAt`。
4. **把 `SKILL.md` 和 `references/api-reference.md` 注入上下文** —— 任何跟 Ornn 相关的任务前都得做。

四步跑完,agent 就接好了 —— 之后每次 Ornn 操作都是一次 API 调用对一个有文档的契约。

## 在 GUI 里找到这个 system skill

你也可以在 registry 里发现 manual —— `ornn-agent-manual-cli` 和 `ornn-agent-manual-http` 都出现在 [registry](/explore) 的 **System Skills** tab。详情页渲染安装提示词构建器(就是你会注入到 agent 的那段 prompt)加上完整的包预览。
