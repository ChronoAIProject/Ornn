# NyxID CLI Recipes

Companion to `SKILL.md` §1. Quick lookup for `nyxid` CLI subcommands. Each subcommand is shown with its required flags and the most common optional ones; full flag tables are in `nyxid <subcommand> --help`. The CLI auto-attaches the bearer token from `~/.nyxid/access_token` (or `$NYXID_API_KEY`); you don't pass it manually.

> Once you have run `nyxid login --base-url <URL>`, the URL is persisted to `~/.nyxid/base_url`. **You do not need to pass `--base-url` on subsequent commands.** To switch environments, log out, log in to the other URL.

---

## Install / version

```bash
# From git (requires Rust toolchain — https://rustup.rs)
cargo install --git https://github.com/ChronoAIProject/NyxID nyxid-cli

# From local checkout
git clone https://github.com/ChronoAIProject/NyxID && cd NyxID && cargo install --path cli

# Verify
nyxid --version
nyxid status                                              # base URL + auth state
```

If a CLI command fails with an unrecognised flag or missing subcommand, the CLI is outdated. Reinstall first.

---

## Login / logout / refresh

```bash
# Browser-mode login (opens browser for OAuth)
nyxid login --base-url <NYXID_API_BASE>
nyxid login --base-url https://nyx-api.chrono-ai.fun     # production
nyxid login --base-url http://localhost:3001             # local self-host

# Headless / AI-agent password login (user sets $NYXID_PASSWORD first)
nyxid login --base-url <URL> --password --password-env NYXID_PASSWORD --email <email>

# Verify
nyxid whoami
nyxid status

# Force a token refresh (rare — auto-refresh is default)
nyxid auth refresh

# Log out (deletes ~/.nyxid/access_token + base_url)
nyxid logout
```

Tokens persist at `~/.nyxid/access_token` and `~/.nyxid/refresh_token`. Base URL persists at `~/.nyxid/base_url`.

---

## Identity

```bash
# Caller identity (userId, email, displayName, roles, permissions)
nyxid whoami

# Status (base URL, login state, token freshness)
nyxid status
```

If `whoami` shows roles but empty permissions, see `nyxid-token-model.md` §4.1 (headers-mode propagation).

---

## API keys (NyxID-side, long-lived bearers)

```bash
# Create — returns the full key value ONCE; save it immediately
nyxid api-key create --name "AI Agent Key" --scopes "read write"

# With callback URL (channel bot relay)
nyxid api-key create --name "relay-agent" --callback-url "https://my-agent.example.com/webhook"

# List
nyxid api-key list                                        # human table
nyxid api-key list --output json

# Show full details (bindings, allowed services, allowed nodes)
nyxid api-key show <ID>

# Rotate (issues a new value, invalidates old)
nyxid api-key rotate <ID>

# Delete
nyxid api-key delete <ID>

# Bindings — restrict the key to specific services
nyxid api-key bind <ID> --service <SLUG>
nyxid api-key bind <ID> --service <SLUG> --credential <LABEL>   # explicit override

# Restrict to bound services only
nyxid api-key update <ID> --allow-all-services false

# Restrict to specific nodes
nyxid api-key update <ID> --allowed-nodes "<NODE_ID>" --allow-all-nodes false

# Update callback URL
nyxid api-key update <ID> --callback-url "https://..."
```

Use the value as `Authorization: Bearer nyxid_...` in HTTPS calls, or export as `$NYXID_API_KEY` for the CLI to pick up automatically.

---

## Catalogue (read-only — discover available services)

```bash
# Browse — connectable services only
nyxid catalog list

# Include system / no-auth services
nyxid catalog list --all

# Inspect a single service template
nyxid catalog show <slug>
nyxid catalog show llm-openai

# Endpoints parsed from the service's OpenAPI spec
nyxid catalog endpoints <slug>
```

The `show` response includes rich metadata: `homepage_url`, `repository_url`, `openapi_spec_url`, `capabilities` flags, `auth_notes`, `known_limitations`, `required_permissions`.

---

## Services (your installed AI services)

```bash
# List all your services
nyxid service list
nyxid service list --output json

# Show full detail
nyxid service show <slug>

# Add from catalogue (user exports $SERVICE_CREDENTIAL first; agent never sees the value)
nyxid service add <slug> --credential "$SERVICE_CREDENTIAL" --label "Production"

# Catalogue + custom endpoint URL (e.g. self-hosted instance)
nyxid service add llm-openclaw --credential "$SERVICE_CREDENTIAL" \
  --endpoint-url "http://localhost:18789" --label "Local OpenClaw"

# OAuth flow
nyxid service add github --oauth                          # opens browser

# Fully custom — no catalogue entry
nyxid service add-custom \
  --label "Internal API" \
  --endpoint-url "https://internal.corp.com/api" \
  --credential "$SERVICE_CREDENTIAL" \
  --auth-method header --auth-key-name "X-API-Key"

# Update — rename
nyxid service update <slug> --label "My Custom Name"

# Update — endpoint URL
nyxid service update <slug> --endpoint-url "http://localhost:8080/openai"

# Route through a node
nyxid service update <slug> --node-id "<NODE_UUID>"
nyxid service route <SERVICE_ID> --node <NODE_ID>          # equivalent
nyxid service route <SERVICE_ID> --direct                  # back to direct routing

# Delete
nyxid service remove <slug>

# Add a service routed through a node in one call (creates backend record + sets routing)
nyxid service add <slug> --via-node <node-name-or-id>
nyxid service add --custom --via-node <node-name-or-id>    # interactive prompts for URL + auth
```

---

## SSH services

```bash
# Register an SSH service (admin-only; --via-node optional)
nyxid service add-ssh \
  --label "Production Server" --host 10.0.0.5 --port 22 \
  --cert-auth --principals "ubuntu,deploy" --ttl 30 --via-node "$NODE_ID"

# Issue a short-lived user certificate
nyxid ssh issue-cert <SERVICE_ID_OR_SLUG> \
  --public-key-file ~/.ssh/id_ed25519.pub \
  --principal ubuntu \
  --certificate-file ~/.ssh/id_ed25519-cert.pub

# Remote command execution
nyxid ssh exec <SERVICE_ID_OR_SLUG> --principal ubuntu -- uptime

# Interactive terminal
nyxid ssh terminal <SERVICE_ID_OR_SLUG>
nyxid ssh terminal <SERVICE_ID_OR_SLUG> --principal ubuntu

# OpenSSH ProxyCommand integration
nyxid ssh proxy <SERVICE_ID_OR_SLUG>

# With auto certificate issuance
nyxid ssh proxy <SERVICE_ID_OR_SLUG> \
  --issue-certificate \
  --public-key-file ~/.ssh/id_ed25519.pub \
  --principal ubuntu \
  --certificate-file ~/.ssh/id_ed25519-cert.pub

# Generate an OpenSSH config stanza
nyxid ssh config \
  --host-alias prod-server \
  --base-url <NYXID_API_BASE> \
  --service-id "$SERVICE_ID" \
  --principal ubuntu \
  --identity-file ~/.ssh/id_ed25519 \
  --certificate-file ~/.ssh/id_ed25519-cert.pub
```

---

## Proxy (call upstream APIs through NyxID with credential injection)

```bash
# Standard JSON request
nyxid proxy request <slug> <path-after-base-url> \
  --method POST --data '{"foo":"bar"}' --output json

# Streaming response
nyxid proxy request llm-openai v1/chat/completions \
  --method POST --stream \
  --data '{"model":"gpt-4","stream":true,"messages":[{"role":"user","content":"Hello"}]}'

# By service ID instead of slug
nyxid proxy request <SERVICE_ID> v1/chat/completions --by-id \
  --method POST --data '{...}'

# Custom headers
nyxid proxy request <slug> <path> \
  --method GET --header "X-Custom: value"

# Discover what the caller can route through
nyxid proxy discover --output json
```

Path is everything *after* the service's base URL. The proxy prepends the service base + injects the configured credential automatically.

---

## Approvals (transaction approval / per-request gating)

```bash
# Configure a service to require approval — per-request mode (default)
nyxid approval set-config <SERVICE_ID> --require-approval true

# Grant mode (legacy — approval creates a time-based grant)
nyxid approval set-config <SERVICE_ID> --require-approval true --approval-mode grant

# View pending approval requests
nyxid approval list
nyxid approval show <REQUEST_ID>

# Approver actions
nyxid approval approve <REQUEST_ID>
nyxid approval deny <REQUEST_ID> --reason "Not authorized for production data"

# Grants (only relevant in grant mode)
nyxid approval grants
nyxid approval revoke-grant <GRANT_ID>

# Per-service configs
nyxid approval service-configs
```

When a request hits an approval-gated service, the proxy returns `403 7000` (pending) or `403 7001` (failed) with an `action_description` and `approve_url`.

---

## Notifications (Telegram / mobile push for approvals)

```bash
nyxid notification settings                               # current preferences
nyxid notification update --approval-email true \
                          --approval-push true \
                          --approval-telegram true
nyxid notification telegram-link                          # link Telegram account
nyxid notification telegram-disconnect
```

---

## Nodes (on-premise credential agents)

```bash
# Generate a registration token (admin or self-service depending on policy)
nyxid node register-token

# Register the node (run on the box where the agent will live)
nyxid node register --token "<NYX_NREG_TOKEN>" --url "wss://localhost:3001/api/v1/nodes/ws" --keychain
nyxid node register --token "<NYX_NREG_TOKEN>" --url "wss://localhost:3001/api/v1/nodes/ws"

# Add a credential locally (auto-detects setup based on catalog)
nyxid node credentials setup --service <SLUG>

# Manual add for custom endpoints (register backend record first)
nyxid service add --custom --via-node <NODE>
nyxid node credentials add --service <SLUG> --header "Authorization" --secret-format Bearer

# OAuth flow from the node
nyxid node credentials add-oauth --service <SLUG> --from-catalog

# List / remove credentials
nyxid node credentials list
nyxid node credentials remove --service <SLUG>

# Lifecycle
nyxid node start                                          # foreground
nyxid node start --log-level debug

# Daemon (background service)
nyxid node daemon install
nyxid node daemon start
nyxid node daemon status
nyxid node daemon restart
nyxid node daemon stop
nyxid node daemon logs --follow
nyxid node daemon uninstall

# Node management (server-side)
nyxid node list
nyxid node show <NODE_ID>
nyxid node delete <NODE_ID>
nyxid node rotate-token <NODE_ID>

# Secret-storage migration
nyxid node migrate --to keychain
nyxid node migrate --to file

# OpenClaw integration
nyxid node openclaw connect --url <GATEWAY_URL>
nyxid node openclaw status
nyxid node openclaw disconnect
```

Daemon paths:

- macOS: `~/Library/LaunchAgents/dev.nyxid.node.plist`
- Linux: `~/.config/systemd/user/nyxid-node.service`

The daemon auto-reloads credentials within 5 seconds of file changes — no restart needed for routine credential rotation.

---

## MCP setup (auto-configure your AI tool)

```bash
nyxid mcp setup cursor       # writes .cursor/mcp.json
nyxid mcp setup claude       # writes .claude/settings.json MCP entry
nyxid mcp setup codex        # writes ~/.codex/config.toml entry
```

Manual setup (any AI client):

```bash
# Claude Code
claude mcp add --transport http --scope user nyxid http://localhost:3001/mcp

# Cursor — edit .cursor/mcp.json
{ "mcpServers": { "nyxid": { "url": "http://localhost:3001/mcp" } } }

# Codex — edit ~/.codex/config.toml
[mcp_servers.nyxid]
url = "http://localhost:3001/mcp"
```

After setup, restart the AI client; it'll prompt for OAuth in the browser on first use.

---

## OAuth clients (for "Sign in with NyxID" apps)

CLI subcommands are limited; most operations go through HTTP. For full HTTP catalogue see `nyxid-api-reference.md` § "Developer Apps". Typical usage:

```bash
# (HTTP) Register a public OAuth client (no secret)
curl -X POST "$NYXID_BASE/api/v1/developer/oauth-clients" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "My App",
    "redirect_uris": ["https://myapp.example.com/auth/callback"],
    "client_type": "public",
    "allowed_scopes": ["openid", "profile", "email"]
  }'

# (HTTP) Rotate secret for confidential client
curl -X POST "$NYXID_BASE/api/v1/developer/oauth-clients/<id>/rotate-secret" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Common usage patterns

### Multi-environment switching

The CLI tracks one base URL at a time. To flip between staging / prod / local:

```bash
nyxid logout
nyxid login --base-url <other-base>
```

Tokens are not shared across environments — logging out of prod and into local always re-prompts.

### Background-process token usage

For scripts / cron / daemons that can't run `nyxid login` interactively:

```bash
# Once, with a human at the keyboard
nyxid api-key create --name "cron-job" --scopes "proxy read"
# Save output to e.g. /etc/secrets/nyxid_api_key (mode 0600)

# In the script
export NYXID_API_KEY="$(cat /etc/secrets/nyxid_api_key)"
nyxid proxy request ornn-api "/api/v1/skill-search?scope=public&pageSize=5" --method GET --output json
```

The CLI uses `$NYXID_API_KEY` when no interactive token exists. The bearer is sent as `X-API-Key` for API-key-mode and `Authorization: Bearer` for OIDC-token-mode — same endpoints, same response shapes.

### Diagnosing CLI-side auth failures

```bash
nyxid status                                              # is the base URL set, is there a token, when does it expire
nyxid whoami                                              # what does the server say about your identity
nyxid auth refresh                                        # force a refresh — useful if `whoami` says expired
```

If `whoami` returns identity but Ornn calls 403, the issue is permission-side (see `nyxid-token-model.md` §6) not auth-side.

---

## Globals

`--log-level <trace|debug|info|warn|error>` — verbose CLI logging. Default `info`.
`--config <PATH>` — alternate config dir for `nyxid node` (default `~/.nyxid-node`).
`--output <table|json>` — preferred output format (default human table; use `json` for parsing).
