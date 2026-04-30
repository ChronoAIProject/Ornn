---
version: 1.0.0
lastUpdated: 2026-04-28
---


# Ornn 与 SkillMP 的对比

SkillMP 和 Ornn 都把自己定位在 AI agent skill 上，但它们不是同一种产品。判断哪个适合你，主要看你是在"逛"还是在"造"。

## TL;DR

| | SkillMP | Ornn |
|---|---|---|
| **产品形状** | Marketplace —— 给人逛的目录站，有 creator 页、评分、浏览式发现 | API 层 —— agent 直接调用 API 来管理它自己的 skill 生命周期 |
| **主要消费者** | 挑 skill 安装的人 | runtime 中的 AI agent |
| **认证** | 站内账号 | NyxID OAuth —— API 边缘有真实组织 / 用户身份 |
| **Per-skill ACL** | 公开 / "premium" 列表；单位是 skill，不是接收者 | 私有 / 给指定用户 / 给指定组织 / 公开 —— 接收者是真实身份 |
| **信任信号** | 评分 + 作者声誉 —— 社交化 | 每个版本的审计 verdict（绿/黄/红）+ 变成 risky 时给使用者发通知 |
| **构建 / 发布** | 上传 skill、填列表、等 marketplace 审核 | 程序化：`POST /skills`、`POST /skills/pull` 或 `POST /skills/generate`（SSE） |
| **程序化 API** | 有限或没有 | 一等公民 —— 每个操作都是 HTTP / MCP 调用 |
| **最适合** | 浏览、为某个 skill 付费、发布出售 skill | 构建 agentic 系统，技能管理在代码里发生而不是在 UI 里 |

## SkillMP 擅长什么

Marketplace 擅长三件事：**发现**、**变现**、**社交背书**。如果你想用类似 Chrome extension 的方式找一个 skill，marketplace 形状是对的；如果你想为自己 skill 的访问权 / 使用次数收钱，你需要一个本身有 billing / rev-share 故事的产品；如果你更信任 4.8 星 12k 安装这种数字而不是你自己审计 pipeline 的 verdict —— marketplace 占优。

## Ornn 擅长什么

agent 在 runtime 中发生的所有事，加上身份感知的操作：

- **搜索 → 拉取 → 执行** 各是一次 HTTP 调用，agent 不离开它的循环。
- **Per-skill ACL 是真 ACL**，不是 honor-system 的"私有列表"。把私有 skill 分享给 `org_xyz`，意思是 NyxID 里 `org_xyz` 的所有人能看到，其它人看不到。
- **审计 verdict 是结构化数据**，不是星级。skill 变成 yellow/red 时使用者自动收到 `audit.risky_for_consumer` 通知；作者每次审计完成时收到 `audit.completed`。
- **AI 原生发布。** 从 prompt 或源码生成 skill。流式输出。校验。上传。全部在代码里完成。

## 怎么选

| 你是… | 选 |
|---|---|
| 单干的开发者，希望自己 skill 被人发现 | SkillMP-style marketplace |
| 想靠 skill 安装 / 调用收钱 | SkillMP-style marketplace |
| 在做一个 runtime 中要调用一堆 skill 的 agent | **Ornn** |
| 在企业内部运行 skill，组织边界很重要 | **Ornn** |
| 想把 skill 做进 CI/CD（发布即审计、替换即 deprecate） | **Ornn** |

## 二者并非互斥

如果一个 marketplace 暴露了程序化的列表 API，Ornn 可以把它本地镜像，然后用 agent-API 契约对外服务。公开 skill 内容就是联邦的原语 —— 一旦 Ornn 知道去哪取字节，调用 Ornn 的 agent 不在意原始来源是 Ornn 还是 marketplace。这是另一个工作流，不是上面对比表的替代。
