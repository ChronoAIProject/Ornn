# NyxID

## 概述

NyxID 是 Ornn 依赖的身份认证和 AI 网关服务，提供认证和 LLM 访问。

## 认证

### OAuth 2.0

Web UI 使用 NyxID 的 OAuth 流程：

1. 用户点击"使用 NyxID 登录"
2. 重定向到 NyxID 授权端点
3. 用户认证并授权
4. 带授权码重定向回来
5. 用授权码交换 JWT 令牌

### JWT 验证

API 请求在 Authorization 头中包含 JWT。后端使用 NyxID 的 JWKS 端点验证令牌。

### API 密钥

对于机器间访问，NyxID 发放 API 密钥，可替代 JWT 使用。

## LLM 网关

NyxID 提供统一的 LLM 网关，抽象多个 LLM 提供商：

### 支持的操作

- **对话补全** — 多轮对话
- **文本嵌入** — 语义搜索的向量表示
- **流式传输** — 通过 SSE 的实时 token 流

### API 格式

网关使用 **Responses API** 格式：

```bash
POST /v1/responses
Content-Type: application/json
Authorization: Bearer <token>

{
  "model": "...",
  "input": [
    { "role": "user", "content": "Hello" }
  ]
}
```

## 用户管理

NyxID 管理：

- 用户资料和显示名称
- LLM 凭据和配额
- 安全设置（2FA、会话）
- API 密钥生命周期
