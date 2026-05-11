<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="ornn-web/public/logo-dark.svg">
    <img src="ornn-web/public/logo-light.svg" width="200" alt="Ornn" />
  </picture>
</p>

<p align="center">
  <a href="https://github.com/ChronoAIProject/Ornn/actions/workflows/ci.yml"><img src="https://github.com/ChronoAIProject/Ornn/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/ChronoAIProject/Ornn/releases"><img src="https://img.shields.io/github/v/release/ChronoAIProject/Ornn" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ChronoAIProject/Ornn" alt="License" /></a>
</p>

<p align="center">The agent-facing skill-lifecycle API for AI agents.</p>

---

## What is Ornn

Ornn is an **agent-facing skill-lifecycle API**, not a human marketplace.

The primary consumer is the AI agent developer / agentic-system builder. Agents call Ornn directly — over HTTP or MCP — to manage their own skill lifecycle:

```
search → pull → install → execute → build → upload → share
```

Closest analog: **npm registry + npm CLI fused, model-agnostic** — works for Claude, GPT, Gemini, or any custom runtime. Not locked to a single model.

`ornn-web` is a secondary surface for skill owners and platform admins; it is not the primary product.

## How to use Ornn

Ornn is model-agnostic — any AI agent runtime (Claude, GPT, Gemini, or a custom in-house stack) can connect and consume the full skill-lifecycle API. Three steps to bring an agent online:

1. **Install the ChronoAI core service skill into the agent.** This is the bootstrap skill — it introduces Ornn to the agent and drives the rest of the setup.
2. **Let the agent provision the NyxID CLI.** On first run, the core skill instructs the agent to install `nyxid` — the CLI that brokers every Ornn request and response with proper authentication and authorization. The agent follows the skill's setup procedure end-to-end; no manual operator steps required.
3. **Start the conversation.** Once `nyxid` is configured in the agent's environment, ask it to search, install, run, build, or publish Ornn skills. The agent learns the end-to-end lifecycle — `search → pull → install → execute → build → upload → share` — through the same API it just connected to.

## Documentation

Full documentation lives at [ornn.chrono-ai.fun/docs](https://ornn.chrono-ai.fun/docs).

## License

[Apache License 2.0](LICENSE)
