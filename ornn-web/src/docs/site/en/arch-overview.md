# Ornn Architecture Overview

## System Architecture

```mermaid
graph TB
    subgraph Client
        WebUI[Web UI - React SPA]
        AgentSDK[Agent SDK / API Client]
    end

    subgraph Ornn
        API[ornn-api API - Hono]
        Frontend[ornn-web - Vite]
    end

    subgraph Storage
        MongoDB[(MongoDB)]
        ChronoStorage[chrono-storage - S3]
    end

    subgraph External
        NyxID[NyxID - Auth + LLM Gateway]
        Sandbox[chrono-sandbox - Execution]
    end

    WebUI --> Frontend
    WebUI --> API
    AgentSDK --> API
    API --> MongoDB
    API --> ChronoStorage
    API --> NyxID
    API --> Sandbox
```

## Components

### ornn-api (Backend API)

The backend service built with **Hono** on **Bun**. Handles:

- Skill CRUD operations
- Search (keyword + semantic)
- Skill generation (AI-powered via NyxID LLM Gateway)
- Playground chat (streaming SSE)
- Admin operations (categories, tags)

### ornn-web (Web UI)

The React 19 SPA built with **Vite**. Features:

- Skill browsing and search
- Three creation modes (Guided, Free, Generative)
- Interactive playground
- Admin panel

### Data Layer

| Store | Purpose |
|-------|---------|
| **MongoDB** | Skill metadata, user data, categories, tags |
| **chrono-storage** | Skill package files (ZIP storage) |
