# examples/

Minimal, copy-paste-ready starter skills that double as references for the SKILL.md frontmatter and the agent execution contract. Each one is small enough to read in one sitting and small enough to fork as the starting point for a real skill.

| Skill | Language | What it does |
|---|---|---|
| [`text-summarizer/`](text-summarizer) | TypeScript (Bun) | Calls an LLM to summarise the input string. Demonstrates: skill ↔ LLM provider boundary, structured input via stdin JSON, structured output via stdout JSON. |
| [`csv-processor/`](csv-processor) | Python 3 | Parses CSV from a file path argument, computes per-column min/mean/max for every numeric column. Demonstrates: stdlib-only Python skill, file-path inputs, deterministic numeric output. |
| [`api-fetch-wrapper/`](api-fetch-wrapper) | TypeScript (Bun) | Wraps a public weather API. Demonstrates: env-var-based API key handling, error normalisation, retry-aware HTTP. |

## Anatomy of an Ornn skill

Each example is laid out the same way:

```
examples/<name>/
├── SKILL.md          ← frontmatter the registry indexes on + agent-facing prose
├── README.md         ← "what this does" + "how to adapt" (5 lines max)
├── src/
│   └── index.{ts,py} ← the skill entrypoint
└── package.json | pyproject.toml  ← runtime deps
```

`SKILL.md` is the contract: every field in its YAML frontmatter is validated against `ornn-api`'s [skill format schema](../docs/CONVENTIONS.md). The prose body is what the agent reads at runtime to decide whether the skill is relevant and how to call it.

## Running an example locally

Once the [TS SDK](../sdk/typescript) is installed:

```bash
# From repo root
cd examples/text-summarizer
bun install
echo '{"text": "Once upon a time …", "length": 30}' | bun run src/index.ts
```

For the agent-driven workflow (pull from the registry, run in sandbox), see the [SDK quickstart](../README.md#sdk-quickstart) in the main README.

## Adapting an example into your own skill

1. Copy the directory.
2. Update `SKILL.md` `name`, `description`, and `metadata.tag` for your use case.
3. Edit the entrypoint to do your thing — keep the stdin-JSON-in / stdout-JSON-out contract so the sandbox can stream events back to the agent.
4. Bump `version` and publish via `POST /api/v1/skills` (see [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)).

## Why these three?

They cover the three failure-mode-archetypes a real skill author needs to handle:

- **`text-summarizer`** — LLM-backed work, network latency, model-vendor error surface.
- **`csv-processor`** — pure local computation, file I/O, deterministic output (the easy case — useful as a control).
- **`api-fetch-wrapper`** — external HTTP, secret handling, retries — the case that breaks first in production.

If a real skill mixes more than one of these patterns, it's worth splitting.
