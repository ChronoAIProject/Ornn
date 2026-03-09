# Test Specification -- ornn-frontend

## Overview

ornn-frontend uses Vitest as its test runner with React Testing Library for component tests. Tests are colocated with source files using the `*.test.ts` and `*.test.tsx` naming conventions. The test setup configures `@testing-library/jest-dom` matchers via `src/test/setup.ts`.

The testing strategy covers:
- **Utility tests**: Pure function tests for frontmatter parsing, building, validation, and adaptation.
- **Component tests**: React component rendering tests with mocked dependencies and user interaction simulation.
- **Page tests**: Full page rendering tests with mocked stores, API services, and routing.

External dependencies (framer-motion, React Router, Zustand stores, API services) are mocked using `vi.mock()`.

## Unit Tests

### Frontmatter Parser (frontmatter.ts)

| Test ID | Description | Input | Expected Output |
|---------|------------|-------|-----------------|
| UT-FP-01 | Parse nested metadata structure | SKILL.md with nested metadata block | Correct name, description, license, category, runtime, tags |
| UT-FP-02 | Parse Claude-specific fields | `disable-model-invocation`, `user-invocable`, `allowed-tools`, `argument-hint` | Correct boolean/string/array values |
| UT-FP-03 | Auto-map old flat frontmatter to nested | Flat `category: tools_required`, `tools`, `tags` | Mapped to `metadata.category: tool-based`, `toolList`, `tag` |
| UT-FP-04 | Auto-map old flat with runtimes | `category: runtime_required`, `runtimes`, `env`, `dependencies` | Mapped to `runtime-based`, `runtime`, `runtimeEnvVar`, `runtimeDependency` |
| UT-FP-05 | Auto-map old flat with npm dependencies | `tools` + `dependencies` + `env` | Mapped to `toolList`, `runtimeDependency`, `runtimeEnvVar` |
| UT-FP-06 | No frontmatter returns null | Plain markdown without `---` delimiters | `null` |
| UT-FP-07 | Malformed YAML returns null | Invalid YAML syntax | `null` |
| UT-FP-08 | Empty frontmatter returns null | `---\n---` with nothing between | `null` |
| UT-FP-09 | Windows line endings normalized | `\r\n` line endings | Parsed correctly |
| UT-FP-10 | Quoted values handled | `name: "quoted-name"` | Quotes stripped |
| UT-FP-11 | Empty tools array returns undefined | `metadata.category: plain`, no tools | `toolList` undefined |

### Strip Frontmatter (frontmatter.ts)

| Test ID | Description | Input | Expected Output |
|---------|------------|-------|-----------------|
| UT-SF-01 | Strip frontmatter returns body only | SKILL.md with frontmatter + body | Body content without `---` |
| UT-SF-02 | No frontmatter returns full content | Plain markdown | Same content |

### Frontmatter Adapter (frontmatterAdapter.ts)

| Test ID | Description | Input | Expected Output |
|---------|------------|-------|-----------------|
| UT-FA-01 | mapOldCategory: tools_required -> tool-based | `"tools_required"` | `"tool-based"` |
| UT-FA-02 | mapOldCategory: runtime_required -> runtime-based | `"runtime_required"` | `"runtime-based"` |
| UT-FA-03 | mapOldCategory: imported -> plain | `"imported"` | `"plain"` |
| UT-FA-04 | mapOldCategory: undefined -> plain | `undefined` | `"plain"` |
| UT-FA-05 | mapOldCategory: new values pass through | `"tool-based"`, `"mixed"` | Same value |
| UT-FA-06 | adaptOldFrontmatter: already nested passes through | `{ metadata: { category } }` | Same object |
| UT-FA-07 | adaptOldFrontmatter: flat maps to nested | Flat with tools, tags, env, deps | Nested metadata with correct keys |
| UT-FA-08 | adaptOldFrontmatter: runtime_npm_dependencies maps | `runtime_npm_dependencies: ["lodash"]` | `runtimeDependency: ["lodash"]` |
| UT-FA-09 | adaptOldFrontmatter: missing fields default to empty arrays | `{ name: "test" }` only | All metadata arrays empty |
| UT-FA-10 | adaptOldFrontmatter: non-array values coerced to empty arrays | Strings, numbers, booleans as array fields | Empty arrays |
| UT-FA-11 | adaptOldFrontmatter: arrays with non-strings filtered | Mixed type arrays | Only string entries kept |
| UT-FA-12 | yamlKeysToCamel: top-level keys converted | `disable-model-invocation` | `disableModelInvocation` |
| UT-FA-13 | yamlKeysToCamel: metadata sub-keys converted | `runtime-dependency`, `runtime-env-var` | `runtimeDependency`, `runtimeEnvVar` |
| UT-FA-14 | yamlKeysToCamel: unknown keys pass through | `unknownKey` | `unknownKey` |
| UT-FA-15 | camelKeysToYaml: camel to hyphenated | `disableModelInvocation` | `disable-model-invocation` |
| UT-FA-16 | camelKeysToYaml: metadata sub-keys | `runtimeDependency` | `runtime-dependency` |
| UT-FA-17 | Round trip: YAML -> camel -> YAML preserves data | Hyphenated input | Same after round trip |

### Frontmatter Builder (frontmatterBuilder.ts)

| Test ID | Description | Input | Expected Output |
|---------|------------|-------|-----------------|
| UT-FB-01 | Build plain skill emits nested metadata | Plain category with tags | `metadata:` block, `category: plain`, tag list |
| UT-FB-02 | Build runtime-based emits runtime fields | Runtime with deps and env vars | `runtime:`, `runtime-dependency:`, `runtime-env-var:` |
| UT-FB-03 | Build tool-based emits tool list | Tool-based with tools | `tool-list:` with items |
| UT-FB-04 | Build with Claude fields emits non-defaults only | `disableModelInvocation: true`, custom model | Claude fields present |
| UT-FB-05 | Build with defaults omits Claude fields | Default values | No `disable-model-invocation`, `user-invocable`, etc. |
| UT-FB-06 | Build with license and compatibility | MIT license, compat string | `license: MIT`, `compatibility: ...` |
| UT-FB-07 | Quotes special chars properly | Description with `: ` | Double-quoted value |
| UT-FB-08 | Quotes when starts with special char | Description starting with `*` | Double-quoted value |
| UT-FB-09 | Starts and ends with dashes | Any skill | First line `---`, last line `---` |
| UT-FB-10 | buildSkillMd combines frontmatter and body | Metadata + body | Frontmatter block + blank line + body |
| UT-FB-11 | buildSkillMd separates with blank line | Metadata + body | `---\n\n# Body` |

### Skill Frontmatter Schema (skillFrontmatterSchema.ts)

| Test ID | Description | Input | Expected Output |
|---------|------------|-------|-----------------|
| UT-SFS-01 | Constants: 4 frontmatter categories | (constant check) | `["plain", "tool-based", "runtime-based", "mixed"]` |
| UT-SFS-02 | Valid plain category parses | `{ name, description, metadata: { category: "plain" } }` | `success: true` |
| UT-SFS-03 | Valid tool-based parses | With `toolList: ["Bash"]` | `success: true` |
| UT-SFS-04 | Valid runtime-based parses | With `runtime: ["typescript-bun"]` | `success: true` |
| UT-SFS-05 | Valid mixed parses | With both runtime and toolList | `success: true` |
| UT-SFS-06 | Valid with optional Claude fields | All optional fields set | `success: true` |
| UT-SFS-07 | Valid runtime-based with optional fields | Dependencies and env vars | `success: true` |
| UT-SFS-08 | Empty name fails | `name: ""` | `success: false` |
| UT-SFS-09 | Name too long (65 chars) fails | 65-char name | `success: false` |
| UT-SFS-10 | Name starts with hyphen fails | `"-invalid-name"` | `success: false` |
| UT-SFS-11 | Name with uppercase fails | `"My-Skill"` | `success: false` |
| UT-SFS-12 | Name at max length (64) succeeds | 64-char name | `success: true` |
| UT-SFS-13 | Plain with runtime fails | Plain category + runtime array | `success: false` |
| UT-SFS-14 | Plain with toolList fails | Plain category + toolList | `success: false` |
| UT-SFS-15 | Plain with runtimeDependency fails | Plain + deps | `success: false` |
| UT-SFS-16 | Plain with runtimeEnvVar fails | Plain + env vars | `success: false` |
| UT-SFS-17 | Tool-based without toolList fails | Empty toolList | `success: false` |
| UT-SFS-18 | Tool-based with runtime fails | toolList + runtime | `success: false` |
| UT-SFS-19 | Runtime-based without runtime fails | Empty runtime | `success: false` |
| UT-SFS-20 | Runtime-based with toolList fails | runtime + toolList | `success: false` |
| UT-SFS-21 | Mixed without runtime fails | toolList only | `success: false` |
| UT-SFS-22 | Mixed without toolList fails | runtime only | `success: false` |
| UT-SFS-23 | Mixed with both succeeds | runtime + toolList | `success: true` |
| UT-SFS-24 | Lowercase env var fails | `runtimeEnvVar: ["api_key"]` | `success: false` |
| UT-SFS-25 | Valid uppercase env var succeeds | `runtimeEnvVar: ["API_KEY"]` | `success: true` |
| UT-SFS-26 | Too many tags (11) fails | 11 tags | `success: false` |
| UT-SFS-27 | Tag too long (31 chars) fails | Tag with 31 chars | `success: false` |
| UT-SFS-28 | validateSkillFrontmatter valid returns success | Valid plain data | `{ success: true, data }` |
| UT-SFS-29 | validateSkillFrontmatter invalid returns errors | Invalid data | `{ success: false, errors: [...] }` |
| UT-SFS-30 | validateSkillFrontmatter conditional violation returns field path | Missing runtime for runtime-based | Error with `field: "metadata.runtime"` |
| UT-SFS-31 | validateSkillFrontmatter applies defaults | Valid plain, no Claude fields | `disableModelInvocation: false`, `userInvocable: true` |
| UT-SFS-32 | metadataSchema minimal valid | `{ category: "plain" }` | Defaults applied for all arrays |
| UT-SFS-33 | metadataSchema invalid category | `{ category: "unknown" }` | `success: false` |

## Component Tests

### ValidationErrorPanel

| Test ID | Description | Input | Expected Output |
|---------|------------|-------|-----------------|
| CT-VEP-01 | Renders all errors with field paths | 2 errors | Title, "2 errors found", both fields and messages visible |
| CT-VEP-02 | Single error uses singular text | 1 error | "1 error found" |
| CT-VEP-03 | Empty errors returns null | `[]` | `container.firstChild` is null |
| CT-VEP-04 | Custom title displayed | `title="Upload Errors"` | "Upload Errors" visible |
| CT-VEP-05 | Empty field path shows "root" | `field: ""` | "root" text visible |
| CT-VEP-06 | Has alert role for accessibility | Any errors | Element with `role="alert"` present |

### FrontmatterMeta

| Test ID | Description | Input | Expected Output |
|---------|------------|-------|-----------------|
| CT-FM-01 | Renders old flat frontmatter tools and deps | Old format with tools, deps, env | "Required Tools", "Dependencies", "Environment Variables" sections |
| CT-FM-02 | Renders new nested frontmatter tools and deps | New format with metadata block | Same sections as old format |
| CT-FM-03 | No frontmatter returns null | Plain markdown | `container.firstChild` is null |
| CT-FM-04 | Empty metadata returns null | Plain category, no tools/deps | `container.firstChild` is null |
| CT-FM-05 | Displays compatibility section | `compatibility: claude-code >= 1.0` | "Compatibility" and "Runtime" sections visible |

## Page Tests

### OAuthCallbackPage

| Test ID | Description | Input | Expected Output |
|---------|------------|-------|-----------------|
| PT-OC-01 | Link mode with valid token calls link endpoint | sessionStorage link_mode + valid token | `linkOAuthProvider` called, toast shown, navigate to /settings |
| PT-OC-02 | Link mode with expired token refreshes first | Null token, link_mode set | `refreshToken` called, then `linkOAuthProvider` |
| PT-OC-03 | Link mode with failed refresh shows session expired | Null token, refresh returns false | "session expired" error displayed |
| PT-OC-04 | Link mode with conflict shows error | `linkOAuthProvider` rejects | "already linked" error, "Linking Failed" title |
| PT-OC-05 | Link mode cleans up sessionStorage on success | Successful link | `oauth_link_mode` removed |
| PT-OC-06 | Link mode cleans up sessionStorage on failure | Failed link | `oauth_link_mode` removed |
| PT-OC-07 | Link mode error shows "Back to Settings" | Failed link | "Back to Settings" visible, "Back to Login" not visible |
| PT-OC-08 | Login mode calls login endpoint | No link_mode flag | `handleOAuthCallback` called, `linkOAuthProvider` not called |
| PT-OC-09 | Login mode error shows "Back to Login" | Failed login | "Back to Login" visible, "Back to Settings" not visible |
| PT-OC-10 | Login mode new user navigates to onboarding | `isNewUser: true` | Navigate to /onboarding with `requireEmailVerification` |
| PT-OC-11 | Login mode deferred new user stores pending token | `pendingOAuthToken` returned, no user | Navigate to /onboarding, token in sessionStorage, setAuth NOT called |
| PT-OC-12 | Email match displays matched email and modal | `emailMatch: true`, `matchedEmail` | Modal visible with real email |
| PT-OC-13 | Email match stores pending token in sessionStorage | Email match response | `oauth_pending_token` in sessionStorage |
| PT-OC-14 | Email match link calls resolution endpoint | Click "Link to Existing Account" | `resolveEmailMatchLink` called with token |
| PT-OC-15 | Email match create new navigates to onboarding | Click "Create New Account" | `resolveEmailMatchCreateNew` called, navigate to /onboarding |
| PT-OC-16 | Email match link error shows error state | Link resolution fails | Error message, "Authentication Failed" title |
| PT-OC-17 | Email match create new error shows error state | Create new fails | Error message, "Authentication Failed" title |
| PT-OC-18 | Email match no tokens issued initially | Email match response | `setAuth` not called during initial callback |

### OnboardingPage

| Test ID | Description | Input | Expected Output |
|---------|------------|-------|-----------------|
| PT-OB-01 | Auth mode renders onboarding form | Authenticated + needsOnboarding | Form rendered with email required |
| PT-OB-02 | Auth mode unauthenticated redirects to login | Not authenticated, no pending token | Navigate to /login |
| PT-OB-03 | Auth mode send OTP calls authenticated endpoint | Email submitted | `sendOnboardingOtp` called with access token |
| PT-OB-04 | Auth mode complete calls authenticated endpoint | Profile data submitted | `completeOnboarding` called, user updated, navigate to / |
| PT-OB-05 | Pending OAuth mode renders without auth check | Pending token, not authenticated | Form rendered, no redirect to /login |
| PT-OB-06 | Pending OAuth mode send OTP calls unauthenticated endpoint | Email submitted with pending token | `sendOAuthOnboardingOtp` called with pending token |
| PT-OB-07 | Pending OAuth mode complete sets auth session | Profile data submitted | `completeOAuthOnboarding` called, `setAuth` with new token |
| PT-OB-08 | Pending OAuth mode falls back to sessionStorage | No route state, token in sessionStorage | Form rendered |
| PT-OB-09 | Pending OAuth expired token cleans sessionStorage | Expired token error | sessionStorage cleaned |
| PT-OB-10 | Mode detection: pending token sets email required | Pending OAuth mode | `email-required` test ID present |
| PT-OB-11 | Mode detection: auth mode uses route state | Auth mode with requireEmailVerification | `email-required` test ID present |
| PT-OB-12 | Mode detection: auth mode no email required | `requireEmailVerification: false` | `email-required` test ID not present |

## Test Execution

```bash
# Run all tests
npx vitest run

# Run tests in watch mode
npx vitest

# Run a specific test file
npx vitest run src/utils/frontmatter.test.ts

# Run tests matching a pattern
npx vitest run --filter "frontmatter"

# Run with coverage
npx vitest run --coverage
```
