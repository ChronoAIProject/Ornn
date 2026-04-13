# 快速开始

## 网页用户

### 1. 登录

通过 **NyxID**（OAuth）登录。无需单独注册账号 — 你的 NyxID 凭据可直接使用。

### 2. 探索技能

在首页浏览公共技能库。使用搜索栏进行**关键词**或**语义**搜索，按名称、描述或标签查找技能。

### 3. 创建技能

点击导航栏中的 **Build**，选择创建方式：

| 方式 | 适用场景 |
|------|----------|
| **引导式** | 首次创建者 — 逐步向导 |
| **自由编辑** | 有经验的用户 — 直接编写 SKILL.md |
| **AI 生成** | 所有人 — 描述需求，AI 自动构建 |
| **上传** | 已有包 — 上传 ZIP 文件 |

### 4. 在 Playground 中测试

打开任意技能的详情页，点击 **Try in Playground**。Playground 提供：

- 交互式 AI 聊天界面
- 技能包文件预览
- 运行时技能的环境变量配置
- 实时流式响应

---

## Agent 开发者

### 1. 获取 API Key

从 NyxID 账户设置中生成 API Key（格式：`nyx_<64位十六进制>`）。

### 2. 认证

在所有 API 请求中包含你的令牌：

```
Authorization: Bearer <nyxid-jwt-或-api-key>
```

### 3. 搜索技能

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://ornn.chronoai.dev/api/skill-search?query=web+scraper&mode=keyword"
```

### 4. 执行技能

使用 Playground Chat 端点进行完整的技能执行：

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","input":[{"role":"user","content":"运行 chart-generator 技能"}]}' \
  "https://ornn.chronoai.dev/api/playground/chat"
```

服务器处理整个执行生命周期 — 下载包、安装依赖、在沙箱中运行脚本并返回结果。

### 5. MCP 集成

NyxID 可以自动生成 MCP 服务器，将 Ornn 的 API 暴露为 MCP 工具，使 Claude Code 和其他兼容 MCP 的 Agent 能够原生使用 Ornn 技能。
