# ornn-frontend Architecture

## Directory Structure

```
src/
  App.tsx                          # Root component: routing, providers
  main.tsx                         # Entry point: mounts App to DOM
  vite-env.d.ts                    # Vite type declarations

  pages/                           # Route-level page components
    LandingPage.tsx                # Public landing page
    LoginPage.tsx                  # Email/OTP and OAuth login
    OAuthCallbackPage.tsx          # OAuth provider callback handler
    OnboardingPage.tsx             # New user onboarding flow
    ExplorePage.tsx                # Home: skill discovery and browsing
    SkillDetailPage.tsx            # Single skill detail view
    SkillResolvePage.tsx           # Semantic skill search (resolve)
    UploadSkillPage.tsx            # Upload a skill package (.zip)
    CreateSkillGuidedPage.tsx      # Step-by-step skill creation wizard
    CreateSkillFreePage.tsx        # Free-form skill editor
    CreateSkillGenerativePage.tsx  # AI-generated skill creation
    EditSkillPage.tsx              # Edit existing skill metadata
    UploadVersionPage.tsx          # Upload a new version for a skill
    GitHubImportPage.tsx           # Import skill from GitHub repository
    PlaygroundPage.tsx             # Interactive skill playground (chat)
    MySkillsPage.tsx               # Current user's skills
    ProfilePage.tsx                # Public user profile
    SettingsPage.tsx               # User settings
    NotFoundPage.tsx               # 404 page
    landing/                       # Landing page sub-components
    admin/                         # Admin-only pages
      DashboardPage.tsx            # Admin dashboard overview
      UsersPage.tsx                # User management
      CategoriesPage.tsx           # Category management
      TagsPage.tsx                 # Tag management
      ConfigPage.tsx               # Platform configuration
      index.ts                     # Barrel export

  components/                      # Reusable UI components
    layout/                        # App-level layout shells
      RootLayout.tsx               # Main layout (navbar + sidebar + content)
      AdminLayout.tsx              # Admin panel layout
      Navbar.tsx                   # Top navigation bar
      Sidebar.tsx                  # Side navigation
      PageTransition.tsx           # Animated route transitions
    auth/                          # Authentication components
      AuthGuard.tsx                # Protected route wrapper (redirects to login)
      AdminGuard.tsx               # Admin-only route wrapper
      LoginForm.tsx                # Email/OTP login form
      OAuthButtons.tsx             # GitHub and Google OAuth buttons
      OtpInput.tsx                 # OTP code input field
      OnboardingForm.tsx           # New user profile setup
      index.ts                     # Barrel export
    ui/                            # Generic UI primitives
      Button.tsx                   # Button with variants
      Card.tsx                     # Card container
      Input.tsx                    # Text input
      Select.tsx                   # Select dropdown
      Modal.tsx                    # Modal dialog
      Badge.tsx                    # Status/tag badge
      Toast.tsx                    # Toast notifications
      Pagination.tsx               # Page navigation
      Skeleton.tsx                 # Loading skeleton
      NeonSkeleton.tsx             # Themed loading skeleton
      EmptyState.tsx               # Empty state placeholder
      CategoryTooltip.tsx          # Category info tooltip
    form/                          # Form-specific components
      SkillForm.tsx                # Full skill creation/edit form
      TagInput.tsx                 # Tag autocomplete input
      MultiValueInput.tsx          # Multi-value text input
      ToolsInput.tsx               # MCP tools input
      RuntimeSelect.tsx            # Runtime selector
      FileUpload.tsx               # Single file upload
      FolderFileUpload.tsx         # Folder/multi-file upload
      MarkdownEditor.tsx           # Markdown text editor
      StepIndicator.tsx            # Wizard step progress indicator
    skill/                         # Skill-related components
      SkillCard.tsx                # Skill summary card
      SkillGrid.tsx                # Grid layout for skill cards
      SkillMeta.tsx                # Skill metadata display
      SkillFileBrowser.tsx         # File tree browser for skill packages
      SkillFileViewer.tsx          # File content viewer
      SkillPackagePreview.tsx      # Full package preview
      SkillPublicToggle.tsx        # Public/private toggle
      ReadmeViewer.tsx             # Rendered README display
      DownloadButton.tsx           # Skill download action
      FrontmatterMeta.tsx          # SKILL.md frontmatter display
      ValidationErrorPanel.tsx     # Validation error list
      VersionList.tsx              # Version history list
      VersionSelector.tsx          # Version dropdown selector
      guided/                      # Guided creation wizard steps
        StepBasicInfo.tsx          # Step 1: name, description, category
        StepContent.tsx            # Step 2: SKILL.md content
        StepFiles.tsx              # Step 3: package files
        StepPreview.tsx            # Step 4: review and submit
    resolve/                       # Skill resolution (semantic search)
      ResolveQueryForm.tsx         # Search query input
      ResolveResultList.tsx        # Search result list
      ResolveResultCard.tsx        # Individual search result
      PhaseIndicator.tsx           # Search phase progress
      StreamingTokenDisplay.tsx    # Streaming token visualization
      GenerationView.tsx           # AI generation output viewer
    playground/                    # Playground (chat) components
      ChatContainer.tsx            # Chat message area
      ChatMessage.tsx              # Single chat message bubble
      ChatInput.tsx                # Message input area
      PlaygroundSidebar.tsx        # Playground side panel
      CredentialPanel.tsx          # API key/credential manager
      LlmConfigPanel.tsx           # LLM model configuration
      ToolCallCard.tsx             # Tool call visualization
      ToolApprovalBanner.tsx       # Tool execution approval prompt
      PlaygroundIcons.tsx          # Playground-specific icons
    admin/                         # Admin panel components
    editor/                        # Code/content editor components
    icons/                         # Icon components
    import/                        # GitHub import components
    search/                        # Search bar and filter components
    user/                          # User profile components
    ErrorBoundary.tsx              # Global error boundary

  services/                        # API client modules
    apiClient.ts                   # Base HTTP client (fetch wrapper with auth)
    authApi.ts                     # Authentication endpoints (login, OTP, OAuth, refresh)
    userApi.ts                     # User profile endpoints
    adminApi.ts                    # Admin endpoints (users, categories, tags, config)
    skillApi.ts                    # Skill CRUD endpoints
    searchApi.ts                   # Skill search endpoints
    versionApi.ts                  # Skill version endpoints
    fileApi.ts                     # File upload/download endpoints
    importApi.ts                   # GitHub import endpoints
    resolveApi.ts                  # Skill resolution (semantic search) endpoints
    resolveStreamApi.ts            # SSE streaming for skill resolution
    generateStreamApi.ts           # SSE streaming for AI skill generation
    playgroundApi.ts               # Playground REST endpoints
    playgroundStreamApi.ts         # SSE streaming for playground chat

  hooks/                           # Custom React hooks (React Query wrappers)
    useSkills.ts                   # Skill CRUD queries and mutations
    useVersions.ts                 # Version queries and mutations
    useFiles.ts                    # File queries
    useFileUpload.ts               # File upload mutations
    useSemanticSearch.ts           # Semantic search hook
    useSkillResolve.ts             # Skill resolve queries
    useSkillResolveStream.ts       # SSE streaming hook for skill resolution
    useSkillGeneration.ts          # AI skill generation hook
    useGitHubImport.ts             # GitHub import hook
    usePlaygroundChat.ts           # Playground chat hook
    usePlaygroundCredentials.ts    # Playground credential management
    usePlaygroundLlmConfig.ts      # LLM config management
    useAdmin.ts                    # Admin queries and mutations
    useDebounce.ts                 # Debounce utility hook

  stores/                          # Zustand state stores
    authStore.ts                   # Authentication state (user, tokens, session)
    playgroundStore.ts             # Playground state (sessions, messages)
    searchStore.ts                 # Search filters and query state
    importStore.ts                 # GitHub import wizard state
    toastStore.ts                  # Toast notification queue

  types/                           # TypeScript type definitions
    auth.ts                        # Auth types (AuthUser, LoginResponse, etc.)
    user.ts                        # User types (User, UserProfile, etc.)
    admin.ts                       # Admin types (AdminStats, AdminConfig, etc.)
    schemas.ts                     # Skill/version schema types
    skillPackage.ts                # Skill package structure types
    streaming.ts                   # SSE streaming event types
    resolve.ts                     # Skill resolution types
    playground.ts                  # Playground types (Session, Message, etc.)
    github.ts                      # GitHub import types

  utils/                           # Utility functions
    constants.ts                   # App-wide constants
    formatters.ts                  # Date, number, and string formatters
    licenses.ts                    # License list for skill metadata
    fileTreeBuilder.ts             # Build file tree from flat file list
    zipValidator.ts                # Validate uploaded ZIP packages
    frontmatter.ts                 # SKILL.md frontmatter parser
    frontmatterAdapter.ts          # Frontmatter format adapter
    frontmatterBuilder.ts          # Frontmatter string builder
    skillFrontmatterSchema.ts      # Zod schema for SKILL.md frontmatter
    skillCreateSchemas.ts          # Zod schemas for skill creation forms
    generationParser.ts            # Parse AI generation streaming output

  styles/
    neon.css                       # Custom neon theme CSS variables and utilities

  test/
    setup.ts                       # Vitest test setup (Testing Library matchers)
```

## Data Flow

```
User Interaction
  |
  v
Page Component (src/pages/)
  |
  v
Hook (src/hooks/)                    -- React Query for caching, mutations
  |
  v
Service (src/services/)              -- API calls via apiClient.ts
  |
  v
Backend API                          -- ornn-auth / ornn-skill / ornn-playground
```

1. **Pages** are top-level route components. They compose domain components and invoke hooks to fetch or mutate data.
2. **Hooks** wrap React Query (`useQuery`, `useMutation`) to provide cached, deduplicated data fetching with loading and error states. Streaming hooks use SSE via `EventSource`-style fetch.
3. **Services** are plain functions that call the backend REST APIs through `apiClient.ts`. The API client attaches the JWT access token from the auth store and handles base URL resolution.
4. **Backend APIs** are reached via Vite's dev proxy in development (`/api/*` routes) and via nginx reverse proxy in production.

## State Management

Zustand stores manage client-side state that is not server-derived:

| Store | Purpose |
|-------|---------|
| `authStore` | User session, access token (in-memory), auto-refresh timer. Persists user info to localStorage. |
| `playgroundStore` | Active playground sessions, message history, tool call state. |
| `searchStore` | Current search query, filters, and sorting preferences. |
| `importStore` | GitHub import wizard state (repo URL, branch, file selection). |
| `toastStore` | Toast notification queue (success, error, info messages). |

Server state (skills, versions, users, admin data) is managed entirely through React Query caches in the hooks layer.

## Routing

React Router 7 with `BrowserRouter`. Routes are declared in `App.tsx`.

### Route Protection

- **`AuthGuard`**: Wraps all authenticated routes. Redirects to `/login` if no valid session. Redirects to `/onboarding` if the user needs to complete setup.
- **`AdminGuard`**: Wraps `/admin/*` routes. Requires the user's role to be `admin`.

### Route Groups

| Path Pattern | Layout | Guard | Description |
|-------------|--------|-------|-------------|
| `/landing` | None | None | Public landing page |
| `/login` | None | None | Login page |
| `/oauth/callback/:provider` | None | None | OAuth callback |
| `/onboarding` | None | None | New user onboarding |
| `/` | RootLayout | AuthGuard | Explore/home page |
| `/skills/*` | RootLayout | AuthGuard | Skill CRUD pages |
| `/resolve` | RootLayout | AuthGuard | Semantic skill search |
| `/playground` | RootLayout | AuthGuard | Interactive playground |
| `/import/github` | RootLayout | AuthGuard | GitHub import |
| `/my-skills` | RootLayout | AuthGuard | User's skills |
| `/settings` | RootLayout | AuthGuard | User settings |
| `/users/:userId` | RootLayout | AuthGuard | Public user profile |
| `/admin/*` | AdminLayout | AuthGuard + AdminGuard | Admin panel |

## Styling

Tailwind CSS 4 with the `@tailwindcss/vite` plugin. A custom neon theme is defined in `src/styles/neon.css` with CSS custom properties for colors, glows, and gradients. Components use Tailwind utility classes throughout.

## Backend Service Communication

The frontend communicates with three backend microservices through API proxying:

| Route Prefix | Backend Service | Port |
|-------------|----------------|------|
| `/api/auth`, `/api/users`, `/api/admin`, `/api/internal` | ornn-auth | 3801 |
| `/api/skills`, `/api/skill-search`, `/api/skill-format`, `/api/github` | ornn-skill | 3802 |
| `/api/playground` | ornn-playground | 3803 |

In development, Vite's built-in proxy forwards these requests. In production, the nginx config handles the proxying using Docker service names.

### Streaming (SSE)

Several features use Server-Sent Events for real-time streaming:

- **Skill generation** (`generateStreamApi.ts`): Streams AI-generated skill content as it is produced.
- **Skill resolution** (`resolveStreamApi.ts`): Streams semantic search results with phased progress.
- **Playground chat** (`playgroundStreamApi.ts`): Streams LLM responses and tool call results during interactive sessions.

Both the Vite dev proxy and the nginx production config include SSE-specific headers (`Connection: ''`, `proxy_buffering off`) to ensure streaming works correctly.
