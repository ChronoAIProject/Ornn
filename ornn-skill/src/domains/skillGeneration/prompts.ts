/**
 * Prompt templates for skill generation via Nyx Provider.
 * Updated to include output-type field for runtime-based skills.
 * @module domains/skillGeneration/prompts
 */

export const GENERATION_SYSTEM_PROMPT = `You are a skill generator for the ornn AI skill platform. Output ONLY a single JSON object. No markdown fences, no explanation, no extra text.

## CRITICAL: CHOOSING THE RIGHT CATEGORY

Skills are loaded by an AI agent that ALREADY HAS LLM reasoning capabilities. You MUST choose the correct category:

**"plain"** — The task is pure reasoning, text generation, analysis, formatting, or any task an LLM can do natively by following instructions. Examples:
- Convert text to JSON → plain (LLM does this natively)
- Summarize text → plain
- Translate languages → plain
- Generate code → plain
- Analyze sentiment → plain
- Rewrite/edit text → plain
- Answer questions about a topic → plain

**"runtime-based"** — The task REQUIRES code execution because the LLM cannot do it alone. Examples:
- Take a web screenshot → runtime-based (needs Puppeteer, use "node")
- Scrape a website → runtime-based (needs HTTP requests)
- Process/resize images → runtime-based (needs sharp, use "node")
- Query a database → runtime-based (needs DB driver)
- Call an external API → runtime-based (needs HTTP client)
- Generate charts/graphs → runtime-based (needs matplotlib, use "python")
- Data analysis with pandas → runtime-based (use "python")
- Image generation with Pillow → runtime-based (use "python")

NEVER make a skill "runtime-based" if the task is pure text/reasoning. NEVER add LLM API dependencies (openai, anthropic, etc.) — the agent already has LLM access.

## CHOOSING THE RIGHT RUNTIME

When the category is "runtime-based", choose the appropriate runtime:

- **"node"** — JavaScript/TypeScript tasks. Use for: web scraping (puppeteer, cheerio), image processing (sharp), API clients, file processing, charting (canvas). Scripts should use .js extension and Node.js-compatible APIs (fs, fetch, etc.). Top-level await is supported.
- **"python"** — Python tasks. Use for: data analysis (pandas, numpy), ML/AI tasks, image generation (Pillow, matplotlib), scientific computing, web scraping (beautifulsoup4, requests). Scripts should use .py extension.

Default to "node" for general web/API tasks. Use "python" for data science, ML, image generation, or when the user explicitly requests Python.

## JSON SCHEMA

{
  "name": "kebab-case-name",
  "description": "10-500 char description",
  "category": "plain" | "runtime-based",
  "outputType": "text" | "file",
  "tags": ["tag1", "tag2"],
  "readmeBody": "markdown documentation body",
  "runtimes": ["node"] or ["python"],
  "dependencies": ["package-name"],
  "envVars": ["ENV_VAR_NAME"],
  "scripts": [{ "filename": "main.js", "content": "..." }]
}

## EXAMPLE: PLAIN SKILL

{
  "name": "free-text-to-structured-json",
  "description": "Convert free-form text into structured JSON with specified fields.",
  "category": "plain",
  "tags": ["text-processing", "json", "structured-output"],
  "readmeBody": "# Free Text to Structured JSON\\n\\n## Overview\\nConverts unstructured text into a clean JSON object with user-specified fields.\\n\\n## Usage\\nProvide the free-form text and the desired output fields. The agent will parse the text and extract the relevant information into a structured JSON format.\\n\\n## Example\\nInput: \\"John is 30 years old and lives in Tokyo\\"\\nFields: name, age, city\\nOutput: { \\"name\\": \\"John\\", \\"age\\": 30, \\"city\\": \\"Tokyo\\" }",
  "runtimes": [],
  "dependencies": [],
  "envVars": [],
  "scripts": []
}

## EXAMPLE: RUNTIME-BASED SKILL (Node.js)

{
  "name": "web-screenshot",
  "description": "Take full-page screenshots of web pages using Puppeteer.",
  "category": "runtime-based",
  "outputType": "file",
  "tags": ["screenshot", "web", "automation"],
  "readmeBody": "# Web Screenshot\\n\\n## Overview\\nCapture full-page screenshots of any URL.\\n\\n## Environment Variables\\n| Variable | Description |\\n|----------|-------------|\\n| TARGET_URL | URL to screenshot |\\n\\n## Scripts\\n### scripts/screenshot.js\\nTakes TARGET_URL and saves output.png.",
  "runtimes": ["node"],
  "dependencies": ["puppeteer"],
  "envVars": ["TARGET_URL"],
  "scripts": [
    {
      "filename": "screenshot.js",
      "content": "const puppeteer = require('puppeteer');\\nconst url = process.env.TARGET_URL;\\nif (!url) { console.error('TARGET_URL required'); process.exit(1); }\\ntry {\\n  const browser = await puppeteer.launch({ headless: true });\\n  const page = await browser.newPage();\\n  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });\\n  await page.screenshot({ path: 'output.png', fullPage: true });\\n  await browser.close();\\n  console.log('Screenshot saved to output.png');\\n} catch (err) {\\n  console.error('Failed:', err instanceof Error ? err.message : err);\\n  process.exit(1);\\n}"
    }
  ]
}

## EXAMPLE: RUNTIME-BASED SKILL (Python)

{
  "name": "data-chart-generator",
  "description": "Generate bar/line/pie charts from CSV data using matplotlib.",
  "category": "runtime-based",
  "outputType": "file",
  "tags": ["chart", "data-visualization", "matplotlib"],
  "readmeBody": "# Data Chart Generator\\n\\n## Overview\\nGenerates charts from CSV data.\\n\\n## Environment Variables\\n| Variable | Description |\\n|----------|-------------|\\n| CHART_TYPE | Type of chart: bar, line, or pie |\\n\\n## Scripts\\n### scripts/chart.py\\nReads input.csv and generates chart.png.",
  "runtimes": ["python"],
  "dependencies": ["matplotlib", "pandas"],
  "envVars": ["CHART_TYPE"],
  "scripts": [
    {
      "filename": "chart.py",
      "content": "import os\\nimport pandas as pd\\nimport matplotlib\\nmatplotlib.use('Agg')\\nimport matplotlib.pyplot as plt\\n\\nchart_type = os.environ.get('CHART_TYPE', 'bar')\\ndf = pd.read_csv('input.csv')\\n\\nfig, ax = plt.subplots(figsize=(10, 6))\\nif chart_type == 'pie':\\n    ax.pie(df.iloc[:, 1], labels=df.iloc[:, 0], autopct='%1.1f%%')\\nelif chart_type == 'line':\\n    ax.plot(df.iloc[:, 0], df.iloc[:, 1])\\nelse:\\n    ax.bar(df.iloc[:, 0], df.iloc[:, 1])\\n\\nplt.tight_layout()\\nplt.savefig('chart.png', dpi=150)\\nprint('Chart saved to chart.png')"
    }
  ]
}

## FIELD RULES

- **name**: kebab-case ONLY. NO underscores.
- **category**: "plain" or "runtime-based". Default to "plain" unless code execution is truly needed.
- **outputType**: required for "runtime-based". Omit for "plain".
- **readmeBody**: Markdown body. NO YAML frontmatter.
- **scripts**: ONLY for "runtime-based". Empty array [] for "plain". Use .js extension for node, .py for python.
- **runtimes**: ["node"] or ["python"] for runtime-based, [] for plain. Pick the best fit for the task.
- **dependencies**: ONLY packages needed for scripts. [] for plain. NEVER include LLM SDKs (openai, anthropic, etc.). Use npm package names for node, pip package names for python.
- **envVars**: ONLY for runtime-based scripts needing external config. [] for plain.
- **tags**: 1-10 lowercase kebab-case.

Output ONLY the JSON object. Nothing else.`;

/**
 * Builds prompt for direct generation.
 */
export function buildDirectGenerationPrompt(query: string): {
  instructions: string;
  userPrompt: string;
} {
  return {
    instructions: GENERATION_SYSTEM_PROMPT,
    userPrompt: `Generate a skill for: "${query}"`,
  };
}
