# Quick Start as a Web User

## 1. Sign In

Log in via **NyxID** at [https://nyx.chrono-ai.fun/](https://nyx.chrono-ai.fun/). Ornn relies on NyxID for user management and access control — your NyxID account is universal across Ornn and all affiliated services.

## 2. Browse Skills

Click **Registry** in the navigation bar to go to the public skill library. Click **My Skills** on the right to switch to your private skill library, which only you can access. Use the search bar for keyword or semantic search to find skills by name or description.

## 3. Create a New Skill

Click **Build** in the navigation bar, then choose a creation method:

| Method | Best For |
|--------|----------|
| **Guided** | First-time creators — step-by-step wizard |
| **Free-form** | Experienced users — upload a pre-built ZIP |
| **Generative** | Describe what you need — AI builds it for you |

### Guided Mode

1. Click **Start Guided Mode**
2. **Basic Info** — Enter a name, select a category, and add tags for your skill
3. **Content** — Write the SKILL.md body (the main prompt content) using the Markdown editor with live preview
4. **Files** — Add any supporting files (scripts, references, assets) to your skill package
5. **Preview** — Review the full skill package structure, then click **Create Skill**

### Free-form Mode

1. Click **Start Free-form Mode**
2. Drag and drop a `.zip` file (or click to browse) containing your pre-built skill package
3. The platform will automatically validate the package structure and extract metadata
4. Review the preview, then click **Upload Skill**

### Generative Mode

1. Click **Start Generative Mode**
2. Describe what you want the skill to do in the text input
3. AI will generate the full skill in real time with streaming output
4. Review the generated SKILL.md and files in the preview panel
5. Refine via follow-up messages if needed, then click **Save Skill**

## 4. View, Edit & Test Your Skill

Your newly created skill is stored in your **private skill library**. You can choose to make it public to share with other Ornn users, or keep it private (only you can use it).

Click on the skill you just created to enter its detail page:

- **Left panel** — The full skill package contents. The top-level folder name is your skill name. `SKILL.md` in the root directory is the main prompt file, containing YAML-formatted frontmatter at the top and prompt Markdown text below. Your skill may also include folders like `references/`, `assets/`, `scripts/` — files in these folders serve as supporting content. For example, a skill that calls Gemini image generation to create images from a description might have script files under `scripts/` and environment variables, runtime, and runtime dependencies declared in the SKILL.md frontmatter.

- You can edit and delete any file in the package. Click the **Save** button in the top right to confirm your changes. When saving, a dialog may ask whether to skip validation — we recommend only advanced users skip this, as the validation step ensures consistent skill formatting.

- **Right panel** — The skill's description, tags, author, and other metadata. Below you can:
  - Click **Try in Playground** to test the skill interactively
  - Click **Download Skill Package** to download the skill for local use with your AI agent
  - If you are the author, toggle the skill between public and private, or delete it

## 5. Try It in the Playground

Click **Try in Playground** to open the sandbox playground. If the skill requires any environment variables, make sure to set them in the **Environment Variables** section in the top right.

Now start chatting on the left — imagine you are working with an agent equipped with this skill. Ask it to invoke the skill and perform related tasks for you.
