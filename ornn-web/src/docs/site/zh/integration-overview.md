# Ornn 集成概览

## 集成点

Ornn 与多个外部服务集成以提供完整功能。

## NyxID 集成

### 认证

- **OAuth 2.0** — Web UI 登录流程
- **JWT 验证** — 通过 JWKS 的 API 请求认证
- **API 密钥校验** — 机器间认证

### LLM 网关

NyxID 提供统一的 LLM 网关，Ornn 用于：

- 技能生成（生成模式）
- 试验场对话（技能中介的对话）
- 语义嵌入生成（用于向量搜索）

网关遵循 **Responses API** 格式。

## chrono-storage 集成

Ornn 使用 chrono-storage（S3 兼容）进行技能包管理：

- **上传** — 存储技能 ZIP 包
- **下载** — 检索包以执行或预览
- **删除** — 技能删除时清理
- **预签名 URL** — 安全的限时访问

## chrono-sandbox 集成

沙箱服务执行技能脚本：

```
POST /execute
{
  "runtime": "node",
  "code": "...",
  "dependencies": ["axios@1.6.0"],
  "envVars": { "API_KEY": "..." },
  "timeout": 30000
}
```

响应包括 stdout、stderr、退出码和生成的文件产物。
