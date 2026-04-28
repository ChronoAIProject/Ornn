# Ornn 与 Vercel `skills.sh` 的对比

两个项目都在托管 AI agent skill。它们解决的问题不一样。这一页讲清什么时候用谁。

## TL;DR

| | `skills.sh`（Vercel） | Ornn |
|---|---|---|
| **主要消费者** | 浏览目录的人类开发者 | 调用 API 的 agent |
| **Surface** | 静态目录站 + GitHub 后端的列表页 | HTTP / MCP API + 次要 Web UI |
| **Skill 格式** | 托管在 GitHub 上的 repo，渲染成列表 | 可移植的 ZIP 包（SKILL.md + 脚本 + 元数据） |
| **认证** | 无 —— 公开列表 | NyxID OAuth（真实 user / org 身份） |
| **授权** | 无 | Per-skill ACL（私有 / 给指定用户 / 给指定组织 / 公开） |
| **信任信号** | 无 | 每个版本都有审计 verdict（绿 / 黄 / 红），并对使用者发通知 |
| **沙箱** | Vercel Functions / 外部 | 一等公民（chrono-sandbox），有 playground UI |
| **最适合** | 发现、营销、人类快速看一眼 | agent 在 runtime 自动管理 skill，企业场景 |

## `skills.sh` 擅长什么

打磨过的目录体验。容易浏览、容易收藏、容易把链接发给同事。Vercel 强在面向人类的 dev-tooling 打磨。如果消费者是人类 —— 想扫一眼列表、复制一段代码、跑起来 —— `skills.sh` 是合适的形状。

它也是免费的。Skill 本身通常住在公开 GitHub repo 里，对开源 skill 来说够用。

## Ornn 擅长什么

agent 决定要用某个 skill 之后所有要做的事，加上身份感知的操作：

- **程序化列表**：keyword + semantic 搜索一次 HTTP 调用搞定。
- **程序化 install**：一次调用拿到 JSON 化的整包（`GET /skills/:idOrName/json` 返回 `{ files: [{ path, content }] }`，agent 直接注入到上下文）。
- **程序化发布**：SSE 流式 AI 生成。agent 可以生成新 skill、校验、发布，都不离开它的循环。
- **身份感知的分享**：把私有 skill 分享给一个用户、一个组织、一组组织。真 ACL，不只是 public/private。
- **审计 verdict + 通知**：每个 skill 都有 verdict。变成 yellow/red 时使用者会被 NyxID 通知，不需要轮询目录。
- **执行数据**：每个 skill 的拉取数（按 API / web / playground 来源拆分）+ 延迟和成功率。

## 怎么选

| 你是… | 选 |
|---|---|
| 想找个 skill 抄回来改改的人 | `skills.sh` |
| 发布一个公开 skill，一份 markdown 列表就够了 | `skills.sh` |
| 在做一个 agent，要自动发现/拉取/执行 skill | **Ornn** |
| 一个组织，需要把 skill 限定给特定的人/组织看 | **Ornn** |
| 一个组织，需要 skill 变成 risky 时有审计 + 通知链路 | **Ornn** |
| 团队信任要求混合 —— 有的公开、有的私有、有的限定组织 | **Ornn** |

## 二者并非互斥

Ornn 的 `POST /skills/pull` 已经支持把公开 GitHub repo 导入成 Ornn skill。如果将来 `skills.sh` 也提供程序化列表接口，我们会做一个 thin sync 把它的公开列表镜像到 Ornn，让这些 skill 也能流过 agent-API 契约 —— 但这是另外一个工作流，不是上面对比表的替代。
