---
version: 2.0.0
lastUpdated: 2026-04-29
---


# Quick Start as a Web User

This is for skill owners and platform admins managing skills through the GUI. If you're an AI agent looking to call Ornn directly, start with the [Agent Manual quick start](/docs?section=qs-agent-manual) instead.

## 1. Sign in

Log in via **NyxID** at [https://nyx.chrono-ai.fun/](https://nyx.chrono-ai.fun/). Ornn does not maintain its own user accounts — your NyxID identity (and the orgs you belong to) drives every visibility / ACL decision in Ornn.

## 2. Browse skills

Click **Registry** in the navigation bar. The registry has four tabs:

- **System Skills** *(default landing)* — platform-wide skills tied to a NyxID admin service. Always public.
- **Public** — every public skill in Ornn.
- **My Skills** — skills you authored.
- **Shared with Me** — private skills another user / org has shared with you.

Each tab has a search bar at the top and a sidebar of filter chips on the left. The chip groups are tab-specific:

- *System Skills* → filter by NyxID service.
- *Public* → tags + authors.
- *My Skills* → tags + grant-orgs (orgs you've shared with) + grant-users.
- *Shared with Me* → source-orgs (orgs you got grants through) + source-users.

Filter state is encoded in the URL, so any view is bookmarkable / shareable.

## 3. Create a new skill

Click **Build** in the navigation bar. Pick one of four modes — all four CTAs are stylistically uniform; the card title above each button names the mode you're starting:

| Mode | Best for |
|---|---|
| **Guided** | First-time creators — step-by-step wizard |
| **Free** | Experienced authors with an existing ZIP package |
| **Generative** | AI generates the skill from a prompt — refine with chat |
| **Import from GitHub** | Pull a folder from a public GitHub repo as the skill source |

### Guided

Step-by-step form for name + category + tags + `SKILL.md` body + supporting files. Live Markdown preview. Best for first-time skill authors who want the structure laid out.

### Free

Drop a pre-built `.zip` (single root folder, `SKILL.md` at its root). Validation runs automatically; fix any reported issues before uploading. You can opt into "skip validation" if your package doesn't strictly conform to Ornn's format spec.

### Generative

Describe what you need in natural language. AI streams the skill into the right shape. Refine with follow-up messages until the preview looks right, then **Save Skill**.

### Import from GitHub

Paste a single GitHub folder URL — `https://github.com/<owner>/<repo>/tree/<ref>/<path>` (the URL you'd copy from the browser address bar on a folder page). Optionally tick **Skip Ornn package validation** when the upstream wasn't authored against Ornn's package layout. Click **Import** to actually pull and publish; nothing is fetched until you click.

## 4. The skill detail page

Click any skill to open its detail page.

**Hero strip** at the top — name, description, status pills (visibility / version / audit verdict / pulls·7d), owner, primary CTA **Try in Playground**. If the skill is GitHub-linked, a small GitHub icon sits to the left of "Try in Playground" — click to open the deep-linked folder in a new tab.

**Left** — package preview. Tree on the left (defaults to `SKILL.md`), file content on the right. Click any file to view it. If you're the author / admin, **Save** in the top-right confirms edits to the package.

**Right rail** (top to bottom): **Audit** card → **Versions** card → **Visibility** card → **Advanced** button → **Metadata** card → **Danger zone**.

### Versions card → all-versions modal

Click **Browse all versions** to open a modal listing every published version with its date, author, deprecation flag, and audit verdict pill. From here you can:

- **Compare versions** *(button at the top of the modal)* — pick any two versions and see the file-level + line-level diff.
- Click a row to switch the page to that version.
- *(owner / admin)* **Mark deprecated** to flag a version with a warning header (reversible).
- *(owner / admin)* **Delete** to hard-delete a non-latest, non-only version. The button stays visible on the latest / only-version rows but is disabled with a tooltip pointing at the right alternative.

### Visibility card

A single coloured chip:

- **Public** *(green)* — every authenticated Ornn user can see the skill.
- **Limited access** *(yellow)* — private but shared with specific users / orgs.
- **Private** *(grey)* — only you and platform admins can see it.

Click the chip (as the owner) to open the permissions modal and reshape the allow-lists.

### Advanced *(button — opens modal)*

A settings-page-style modal with two surfaces today:

- **Bind to NyxID Service** — tie the skill to a NyxID service. Tying to an admin-tier service marks the skill as a *system skill* (forced public, discoverable platform-wide). Personal-tier ties leave privacy alone.
- **Link to GitHub** — paste a GitHub folder URL to attach a source pointer. **Save** stores the link without pulling. **Sync from GitHub** runs a dry-run preview: if there are no changes, you get an "already in sync" toast; otherwise the panel switches to a sync-preview view rendering a file-level diff with an **Apply sync** button that bumps the version. **Unlink** clears the pointer.

The modal is a fixed 80vh shell — left rail and right pane scroll independently so a long sync diff doesn't push the whole modal taller.

### Try in Playground

Opens the sandbox. Set any required environment variables in the top-right panel; chat on the left as if the skill were already loaded into your agent. For runtime-based skills, the playground executes the scripts in chrono-sandbox and threads the result back through the chat.

## 5. Share a skill

From the detail page, click the visibility chip to open **Permissions**. Pick a tier:

- **Public** — every Ornn user can see it.
- **Limited** — share with specific users (typeahead by email prefix) and / or specific orgs (orgs you belong to).
- **Private** — only you (and platform admins).

Sharing is **unconditional** in Ornn's current model — there's no review queue, no waiver. Saving the form changes ACLs immediately.

## 6. Trigger an audit *(optional)*

The **Audit** card in the right rail surfaces the latest verdict. Click **Start audit** to queue a fresh run; the verdict appears once the pipeline finishes. Audit is a *passive risk label* — it never blocks sharing or pulling. If a verdict comes back `yellow` or `red`, every consumer (people / orgs the skill is shared with) gets an `audit.risky_for_consumer` notification automatically.
