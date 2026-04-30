---
version: 2.0.0
lastUpdated: 2026-04-29
---


# Web 用户快速入门

这一篇是给通过 GUI 管理技能的 skill owner 和平台管理员看的。如果你是想直接调 Ornn API 的 AI agent,请去看 [Agent Manual 快速入门](/docs?section=qs-agent-manual)。

## 1. 登录

通过 **NyxID** 在 [https://nyx.chrono-ai.fun/](https://nyx.chrono-ai.fun/) 登录。Ornn 不维护自己的用户账号 —— 你的 NyxID 身份(以及你属于哪些 org)驱动了 Ornn 里每一次可见性 / ACL 决策。

## 2. 浏览技能

点击导航栏的 **Registry**。Registry 有四个 tab:

- **System Skills** *(默认落地)* — 绑定到 NyxID admin 服务的平台级技能,永远 public。
- **Public** — Ornn 上所有 public 技能。
- **My Skills** — 你创建的技能。
- **Shared with Me** — 别的 user / org 分享给你的私有技能。

每个 tab 顶部有搜索框,左侧有过滤 chip 边栏。Chip 分组随 tab 不同而不同:

- *System Skills* → 按 NyxID service 过滤。
- *Public* → tags + authors。
- *My Skills* → tags + grant-orgs(你分享给的 org)+ grant-users。
- *Shared with Me* → source-orgs(你通过哪些 org 拿到的 grant)+ source-users。

过滤状态编码到 URL 里,任何视图都可收藏 / 分享。

## 3. 创建新技能

点击导航栏的 **Build**。从四个模式里挑一个 —— 四个 CTA 在样式上完全统一,按钮上方的卡片标题告诉你你正在启动的模式:

| 模式 | 适合 |
|---|---|
| **Guided** | 第一次创建技能 — 一步步向导 |
| **Free** | 已有 ZIP 包的资深作者 |
| **Generative** | AI 从 prompt 生成,聊天 refine |
| **Import from GitHub** | 把 public GitHub 仓库的某个文件夹拉进来作为技能源 |

### Guided

一步步表单填 name + category + tags + `SKILL.md` 正文 + 辅助文件。带实时 Markdown 预览。适合第一次创建技能、希望被引导建立结构的人。

### Free

拖一个预先打好的 `.zip`(单一根文件夹,根目录有 `SKILL.md`)。校验自动跑;按报错修完再上传。如果你的包不严格符合 Ornn format,可以勾「跳过校验」。

### Generative

用自然语言描述需求。AI 流式产出技能。用 follow-up 消息 refine 直到预览看着对,再点 **Save Skill**。

### Import from GitHub

粘贴一个 GitHub 文件夹 URL —— `https://github.com/<owner>/<repo>/tree/<ref>/<path>`(在 GitHub 文件夹页从浏览器地址栏复制即可)。如果 upstream 不是按 Ornn 包格式写的,可勾 **跳过 Ornn 包校验**。点 **Import** 才会真的拉取并发布;点之前什么都不会被 fetch。

## 4. 技能详情页

点任意技能进入详情页。

**顶部 Hero 条** —— 名字、描述、状态 pill(visibility / version / 审计 verdict / pulls·7d)、owner、主 CTA **Try in Playground**。如果技能关联了 GitHub,会有一个小 GitHub 图标在 "Try in Playground" 左边 —— 点击在新 tab 打开 deep-linked 文件夹。

**左侧** — 包预览。左边文件树(默认 `SKILL.md`),右边文件内容。点任意文件查看。如果你是 author / admin,顶部右侧的 **Save** 提交对包的修改。

**右侧栏**(从上到下):**Audit** 卡 → **Versions** 卡 → **Visibility** 卡 → **Advanced** 按钮 → **Metadata** 卡 → **Danger zone**。

### Versions 卡 → 全版本 modal

点 **Browse all versions** 打开列出每个已发布版本的 modal,带日期、作者、deprecation 标记和审计 verdict pill。从这里你可以:

- **Compare versions** *(modal 顶部按钮)* — 选任意两个版本看文件级 + 行级 diff。
- 点行切换到那个版本。
- *(owner / admin)* **Mark deprecated** 给版本打上警告 header(可逆)。
- *(owner / admin)* **Delete** 硬删非最新、非唯一的版本。最新 / 唯一版本那行的按钮仍然可见,但 disabled,带 tooltip 指向正确的替代方案。

### Visibility 卡

一个彩色 chip:

- **Public** *(绿)* — 每个已认证 Ornn 用户都能看到。
- **Limited access** *(黄)* — 私有但分享给特定 user / org。
- **Private** *(灰)* — 只有你和平台管理员能看到。

(作为 owner)点击 chip 打开权限 modal,重新塑造 allow-list。

### Advanced *(按钮 — 打开 modal)*

settings 风格的 modal,目前两个 surface:

- **Bind to NyxID Service** — 把技能绑定到 NyxID service。绑定到 admin 层级会把技能标成 *system skill*(强制 public,平台级可见)。Personal 层级绑定不影响隐私。
- **Link to GitHub** — 粘贴 GitHub 文件夹 URL 来挂上 source pointer。**Save** 仅存链接,不拉数据。**Sync from GitHub** 跑 dry-run 预览:无改动则 toast「已是最新」;有改动则面板切到同步预览视图,渲染文件级 diff,带 **Apply sync** 按钮 —— 点击 bump 版本。**Unlink** 清空 pointer。

modal 是固定 80vh 容器 —— 左栏和右栏独立滚动,长 sync diff 不会把整个 modal 撑高。

### Try in Playground

打开试验场。在右上面板填好需要的环境变量;在左边像跟一个已经装好这个技能的 agent 聊天一样使用。对 runtime-based 技能,试验场会在 chrono-sandbox 里跑脚本,把结果穿回到对话里。

## 5. 分享技能

从详情页点 visibility chip 打开 **Permissions**。挑一个层级:

- **Public** — 每个 Ornn 用户都能看到。
- **Limited** — 分享给特定 user(按 email 前缀 typeahead)和 / 或特定 org(你属于的 org)。
- **Private** — 只有你(和平台管理员)。

Ornn 当前模型里的分享是 **无条件的** —— 没有 review 队列、没有 waiver。保存表单立刻改 ACL。

## 6. 触发审计 *(可选)*

右侧栏的 **Audit** 卡显示最新 verdict。点 **Start audit** 排队一次新审计;pipeline 跑完后 verdict 出现。审计是 *被动风险标签* —— 永远不阻塞分享或拉取。如果 verdict 翻 `yellow` 或 `red`,所有消费者(技能分享给的 user / org)会自动收到 `audit.risky_for_consumer` 通知。
