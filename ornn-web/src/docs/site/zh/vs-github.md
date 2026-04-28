---
version: 1.0.0
lastUpdated: 2026-04-28
---


# Ornn 与裸 GitHub 的对比

很多团队已经把 AI agent skill 以 `SKILL.md` 文件的形式放在 GitHub repo 里。能用、免费、你已经会用、agent 可以 curl raw URL 拿到。这一页讲清楚什么时候"裸 GitHub 就够"，什么时候 Ornn 真正开始物有所值。

## TL;DR

| | GitHub repo | Ornn |
|---|---|---|
| **是什么** | 代码托管。存文件。 | Skill 生命周期 API。除了存文件，把围绕文件的所有事情都做了。 |
| **发现** | `gh search`、你自己的书签、README | 跨 registry 的 keyword + semantic 搜索，按调用方可见性 scope |
| **版本** | Git tag / branch —— 你自己设计规则 | 一等公民的 skill 版本；`GET /skills/:idOrName/versions`、`diff/:from/:to` |
| **ACL** | 公开，或付费私有 repo（per-repo） | Per-skill ACL：private / 给指定用户 / 给指定组织 / 公开 —— 不需要 per-repo 付费 |
| **身份** | GitHub 身份，code review 用着不错，但不是"这个 org 里的这个用户"该有的形状 | NyxID OAuth —— API 边缘有真实用户 + 组织成员关系 |
| **信任信号** | 没有 —— 你信任作者 | 每个版本有审计 verdict，变 risky 时给使用者发通知 |
| **沙箱** | 没有 —— agent 自己跑代码 | 一等公民（chrono-sandbox）；试验场 UI 支持 try-before-install |
| **程序化 agent API** | 自己拼（解析 README、raw URL、自定义 auth） | 一个 HTTP / MCP API 解决一切 —— 搜索、拉取、执行、构建、上传、分享 |
| **最适合** | 公开、代码优先、不需要隐私或组织边界的 skill | 多用户、多租户、需要审计能力的 skill 操作 |

## 什么时候裸 GitHub 就够

- 你在发布单个开源 skill，README + raw URL 已经够了。
- 你不需要把 skill 限定给特定的人 —— 公开就行。
- agent 的"安装"步骤就是 `curl raw.githubusercontent.com/...`，你也接受这种方式。
- 搜索不需要超过 `gh search code` 的能力。
- 不需要审计 verdict，"信任作者"够了。

如果上述五条全成立，GitHub 是最便宜的路径，用它。

## 什么时候 Ornn 物有所值

- **多租户。** 有些 skill 应该让一个组织看到，但不让另一个组织看到。GitHub 解决方案是付费私有 repo / 跑组织；Ornn 用 per-skill ACL 解决。
- **混合信任。** 一些 skill 公开，一些限定团队，一些只分享给一个外部合作方。GitHub 强迫你用不同的 repo / 组织建模；Ornn 让你在每个 skill 上拨开关就行。
- **审计 + 通知。** 你在意一个 skill 是否 risky，并且想让使用者自动得知。GitHub 没有；Ornn 当作一等公民来做。
- **程序化 agent 循环。** agent 应该在 *runtime* 自动发现并拉取 skill。GitHub 的方式是 `gh api` 调用 + raw URL 解析 + 你自己的缓存；Ornn 的方式是每个动词一次调用 + 稳定 schema。
- **安装前沙箱。** 想让用户在受控 runtime 里试一下 skill 再装。GitHub 没有；Ornn 试验场就是。
- **使用数据。** 你想要拉取数、执行成功率、来源拆分（API / web / playground）。GitHub 给你 stars 和 clone 数；Ornn 给你与 skill 真正相关的指标。

## 二者并非互斥

`POST /skills/pull` 把公开 GitHub repo 导入成 Ornn skill。Skill 保持与 GitHub 源的链接，所以 `POST /skills/:id/refresh` 可以按需重拉。推荐给那种希望：

- skill 源码 + 版本控制留在 git（已有的开发体验）
- 通过 Ornn 做分发 + 审计 + ACL（GitHub 没有的运维故事）

…的团队。Git 做 source-of-truth，Ornn 做 runtime 分发与信任。
