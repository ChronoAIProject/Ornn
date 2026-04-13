# Ornn 架构概览

## 系统架构

```mermaid
graph TB
    subgraph 客户端
        WebUI[Web UI - React SPA]
        AgentSDK[Agent SDK / API 客户端]
    end

    subgraph Ornn
        API[ornn-api API - Hono]
        Frontend[ornn-web - Vite]
    end

    subgraph 存储层
        MongoDB[(MongoDB)]
        ChronoStorage[chrono-storage - S3]
    end

    subgraph 外部服务
        NyxID[NyxID - 认证 + LLM 网关]
        Sandbox[chrono-sandbox - 执行]
    end

    WebUI --> Frontend
    WebUI --> API
    AgentSDK --> API
    API --> MongoDB
    API --> ChronoStorage
    API --> NyxID
    API --> Sandbox
```

## 组件

### ornn-api（后端 API）

基于 **Bun** 的 **Hono** 后端服务。处理：

- 技能 CRUD 操作
- 搜索（关键词 + 语义搜索）
- 技能生成（通过 NyxID LLM 网关的 AI 驱动）
- 试验场对话（流式 SSE）
- 管理操作（分类、标签）

### ornn-web（Web UI）

基于 **Vite** 的 React 19 SPA。功能：

- 技能浏览和搜索
- 三种创建模式（引导、自由、生成）
- 交互式试验场
- 管理面板

### 数据层

| 存储 | 用途 |
|------|------|
| **MongoDB** | 技能元数据、用户数据、分类、标签 |
| **chrono-storage** | 技能包文件（ZIP 存储） |
