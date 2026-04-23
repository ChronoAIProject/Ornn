# Product FAQs

## What is a skill?

A skill is a packaged AI capability — a combination of a SKILL.md file (containing metadata and documentation) and optional scripts that can be executed by AI agents.

## What skill types are supported?

| Type | Description |
|------|-------------|
| **plain** | Prompt-only skill, no code execution |
| **tool-based** | Uses predefined tools/functions |
| **runtime-based** | Executes scripts in Node.js or Python |
| **mixed** | Combines tools and runtime execution |

## How do I create a skill?

Three ways:
1. **Guided Mode** — step-by-step wizard
2. **Free Mode** — upload a pre-built ZIP
3. **Generative Mode** — describe it and let AI build it

## Can I make my skills private?

Yes. Skills default to private. You can toggle visibility between public and private at any time from the skill detail page.

## What is the Playground?

The Playground is an interactive environment where you can test skills. It provides a chat interface where you can ask questions about a skill or trigger its execution with real environment variables.

## How does authentication work?

Ornn uses **NyxID** for authentication. Sign in with your NyxID account via OAuth. API access uses NyxID API keys.
