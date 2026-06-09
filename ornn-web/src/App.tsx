/**
 * Main Application Component.
 * Configures routing and global providers. All page components are
 * route-level code-split via React.lazy so the initial bundle stays
 * lean — admin / editor / playground chunks only load when their
 * routes are visited.
 *
 * Routing uses RR7's data router (`createBrowserRouter`) — the route
 * tree itself is still authored as JSX through `createRoutesFromElements`
 * so the migration stays minimal-risk; loaders / actions can be added
 * per-route later as wins surface (#103).
 *
 * @module App
 */

import { lazy, Suspense } from "react";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Outlet,
  Route,
  RouterProvider,
  useLocation,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RootLayout } from "@/components/layout/RootLayout";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { AdminGuard } from "@/components/auth/AdminGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { HighlighterMarkFilter } from "@/pages/landing/HighlighterMark";
import { VersionUpdateBanner } from "@/components/layout/VersionUpdateBanner";
import { PostHogProvider } from "@/components/analytics/PostHogProvider";
import { CookieConsentBanner } from "@/components/analytics/CookieConsentBanner";
import { AssistantWidget } from "@/components/assistant/AssistantWidget";

/**
 * Top-level wrapper rendered as the root route's element. Lives INSIDE
 * the router tree so child analytics hooks (`useLocation`) work, and
 * renders the consent banner above every page. PostHogProvider has no
 * DOM output — it just wires init / identify / pageview tracking.
 *
 * The Ornn Assistant mounts here (not RootLayout) so its mascot launcher
 * floats over EVERY page — including the landing page and for anonymous
 * visitors (#976). Suppressed only on the auth handshake routes
 * (`/login`, `/oauth/*`) where a floating chatbot would be noise.
 */
function AnalyticsRoot() {
  const { pathname } = useLocation();
  const hideAssistant = pathname === "/login" || pathname.startsWith("/oauth");
  return (
    <>
      <PostHogProvider />
      <Outlet />
      <CookieConsentBanner />
      {/* Global announcement surface — top-right headline pill on every page. */}
      <AnnouncementBanner />
      {!hideAssistant && <AssistantWidget />}
    </>
  );
}

// Route-level code split. Each lazy() call becomes its own async chunk.
// Pages export named members, so the import() is unwrapped to a default.
const LoginPage = lazy(() =>
  import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const OAuthCallbackPage = lazy(() =>
  import("@/pages/OAuthCallbackPage").then((m) => ({ default: m.OAuthCallbackPage })),
);
const NotFoundPage = lazy(() =>
  import("@/pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })),
);
const LandingPage = lazy(() =>
  import("@/pages/LandingPage").then((m) => ({ default: m.LandingPage })),
);
const DocsPage = lazy(() =>
  import("@/pages/DocsPage").then((m) => ({ default: m.DocsPage })),
);
const ContactPage = lazy(() =>
  import("@/pages/ContactPage").then((m) => ({ default: m.ContactPage })),
);
const NewsPage = lazy(() =>
  import("@/pages/NewsPage").then((m) => ({ default: m.NewsPage })),
);
const PrivacyPolicyPage = lazy(() =>
  import("@/pages/legal/PrivacyPolicyPage").then((m) => ({
    default: m.PrivacyPolicyPage,
  })),
);
const TermsOfServicePage = lazy(() =>
  import("@/pages/legal/TermsOfServicePage").then((m) => ({
    default: m.TermsOfServicePage,
  })),
);
const AcceptableUsePage = lazy(() =>
  import("@/pages/legal/AcceptableUsePage").then((m) => ({
    default: m.AcceptableUsePage,
  })),
);

const ExplorePage = lazy(() =>
  import("@/pages/ExplorePage").then((m) => ({ default: m.ExplorePage })),
);
const SkillDetailPage = lazy(() =>
  import("@/pages/skill/SkillDetailPage").then((m) => ({ default: m.SkillDetailPage })),
);
const SkillAuditHistoryPage = lazy(() =>
  import("@/pages/skill/SkillAuditHistoryPage").then((m) => ({ default: m.SkillAuditHistoryPage })),
);
const UploadSkillPage = lazy(() =>
  import("@/pages/skill/UploadSkillPage").then((m) => ({ default: m.UploadSkillPage })),
);
const CreateSkillGuidedPage = lazy(() =>
  import("@/pages/skill/CreateSkillGuidedPage").then((m) => ({ default: m.CreateSkillGuidedPage })),
);
const CreateSkillFreePage = lazy(() =>
  import("@/pages/skill/CreateSkillFreePage").then((m) => ({ default: m.CreateSkillFreePage })),
);
const CreateSkillGenerativePage = lazy(() =>
  import("@/pages/skill/CreateSkillGenerativePage").then((m) => ({ default: m.CreateSkillGenerativePage })),
);
const CreateSkillFromGitHubPage = lazy(() =>
  import("@/pages/skill/CreateSkillFromGitHubPage").then((m) => ({ default: m.CreateSkillFromGitHubPage })),
);
const EditSkillPage = lazy(() =>
  import("@/pages/skill/EditSkillPage").then((m) => ({ default: m.EditSkillPage })),
);
const PlaygroundPage = lazy(() =>
  import("@/pages/PlaygroundPage").then((m) => ({ default: m.PlaygroundPage })),
);
const MySkillsPage = lazy(() =>
  import("@/pages/skill/MySkillsPage").then((m) => ({ default: m.MySkillsPage })),
);
const ServiceDetailPage = lazy(() =>
  import("@/pages/ServiceDetailPage").then((m) => ({ default: m.ServiceDetailPage })),
);
const NotificationsPage = lazy(() =>
  import("@/pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage })),
);
const SettingsPage = lazy(() =>
  import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

// Admin pages — bundled into one chunk by virtue of sharing the barrel
// import path; only loaded when an /admin route activates.
const AdminDashboardPage = lazy(() =>
  import("@/pages/admin").then((m) => ({ default: m.DashboardPage })),
);
const AdminUsersLegacyPage = lazy(() =>
  import("@/pages/admin").then((m) => ({ default: m.UsersPage })),
);
const AdminUserManagementPage = lazy(() =>
  import("@/pages/admin").then((m) => ({ default: m.UserManagementPage })),
);
const AdminSkillsPage = lazy(() =>
  import("@/pages/admin").then((m) => ({ default: m.AdminSkillsPage })),
);
const AdminQuotaManagementPage = lazy(() =>
  import("@/pages/admin").then((m) => ({ default: m.QuotaManagementPage })),
);
const AdminRedemptionCodesPage = lazy(() =>
  import("@/pages/admin").then((m) => ({ default: m.RedemptionCodesPage })),
);
const AdminAnnouncementsPage = lazy(() =>
  import("@/pages/admin").then((m) => ({ default: m.AnnouncementsPage })),
);
const AdminBroadcastsPage = lazy(() =>
  import("@/pages/admin").then((m) => ({ default: m.BroadcastsPage })),
);
const MirrorPage = lazy(() =>
  import("@/pages/admin/MirrorPage").then((m) => ({ default: m.MirrorPage })),
);

// Settings layout + section components live under pages/admin/settings.
const SettingsLayout = lazy(() =>
  import("@/pages/admin/settings/SettingsLayout").then((m) => ({
    default: m.SettingsLayout,
  })),
);
const LlmProvidersSection = lazy(() =>
  import("@/pages/admin/settings/sections").then((m) => ({
    default: m.LlmProvidersSection,
  })),
);
const PlaygroundSection = lazy(() =>
  import("@/pages/admin/settings/sections").then((m) => ({
    default: m.PlaygroundSection,
  })),
);
const SkillGenSection = lazy(() =>
  import("@/pages/admin/settings/sections").then((m) => ({
    default: m.SkillGenSection,
  })),
);
const MirrorSection = lazy(() =>
  import("@/pages/admin/settings/sections").then((m) => ({
    default: m.MirrorSection,
  })),
);
const NyxIDSection = lazy(() =>
  import("@/pages/admin/settings/sections").then((m) => ({
    default: m.NyxIDSection,
  })),
);
const SkillAuditSection = lazy(() =>
  import("@/pages/admin/settings/sections").then((m) => ({
    default: m.SkillAuditSection,
  })),
);
const TelemetrySection = lazy(() =>
  import("@/pages/admin/settings/sections").then((m) => ({
    default: m.TelemetrySection,
  })),
);
const ExtrasSection = lazy(() =>
  import("@/pages/admin/settings/sections").then((m) => ({
    default: m.ExtrasSection,
  })),
);
const ExportImportSection = lazy(() =>
  import("@/pages/admin/settings/sections").then((m) => ({
    default: m.ExportImportSection,
  })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Minimal fallback while a route chunk is in flight. */
function RouteFallback() {
  return <div className="p-8 text-meta text-sm">Loading…</div>;
}

// Created once at module scope — `createBrowserRouter` is intentionally
// stable across renders.
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<AnalyticsRoot />}>
      {/* Public routes (no auth) */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/oauth/callback" element={<OAuthCallbackPage />} />

      {/* Landing owns its own container — the 820vh hero needs full
          document scroll, and RootLayout's h-screen overflow-hidden
          would trap it. */}
      <Route path="/" element={<LandingPage />} />

      {/* Public routes with RootLayout */}
      <Route element={<RootLayout />}>
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/news" element={<NewsPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/legal/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/legal/terms" element={<TermsOfServicePage />} />
        <Route path="/legal/acceptable-use" element={<AcceptableUsePage />} />
        <Route path="/registry" element={<ExplorePage />} />
        <Route path="/skills/:idOrName" element={<SkillDetailPage />} />
        <Route
          path="/skills/:idOrName/audits"
          element={<SkillAuditHistoryPage />}
        />
      </Route>

      {/* Protected routes */}
      <Route element={<AuthGuard />}>
        <Route element={<RootLayout />}>
          <Route path="/skills/new" element={<UploadSkillPage />} />
          <Route path="/skills/new/guided" element={<CreateSkillGuidedPage />} />
          <Route path="/skills/new/free" element={<CreateSkillFreePage />} />
          <Route path="/skills/new/generate" element={<CreateSkillGenerativePage />} />
          <Route path="/skills/new/from-github" element={<CreateSkillFromGitHubPage />} />
          <Route path="/skills/:id/edit" element={<EditSkillPage />} />
          <Route path="/playground" element={<PlaygroundPage />} />

          <Route path="/my-skills" element={<MySkillsPage />} />
          <Route path="/services/:id" element={<ServiceDetailPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        {/* Admin routes — new IA per Architecture §6.1. Nested under
            RootLayout so admin pages share the same Navbar + breadcrumb
            chrome as every other authenticated route (theme switcher,
            language switcher, user menu, QuotaChip). AdminLayout is now
            a thin sidebar wrapper. */}
        <Route element={<AdminGuard />}>
          <Route element={<RootLayout />}>
            <Route element={<AdminLayout />}>
              <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
              <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
              <Route path="/admin/users" element={<AdminUserManagementPage />} />
              <Route path="/admin/users-legacy" element={<AdminUsersLegacyPage />} />
              <Route path="/admin/skills" element={<AdminSkillsPage />} />
              <Route path="/admin/quota" element={<AdminQuotaManagementPage />} />
              <Route
                path="/admin/redemption-codes"
                element={<AdminRedemptionCodesPage />}
              />
              <Route path="/admin/announcements" element={<AdminAnnouncementsPage />} />
              <Route path="/admin/broadcasts" element={<AdminBroadcastsPage />} />

              {/* /admin/mirror is the deep mirror operations console
                  (counts, manual reconcile, status). It used to redirect
                  to /admin/settings/mirror, but that left admins with no
                  reachable "Manual reconcile" / "Reconcile now" control
                  (#716). The settings section now links here for the
                  full operations view. */}
              <Route path="/admin/mirror" element={<MirrorPage />} />

              <Route path="/admin/settings" element={<SettingsLayout />}>
                <Route
                  index
                  element={<Navigate to="/admin/settings/llm-providers" replace />}
                />
                <Route path="llm-providers" element={<LlmProvidersSection />} />
                <Route path="playground" element={<PlaygroundSection />} />
                <Route path="skill-generation" element={<SkillGenSection />} />
                <Route path="mirror" element={<MirrorSection />} />
                <Route path="integrations/nyxid" element={<NyxIDSection />} />
                <Route path="skill-audit" element={<SkillAuditSection />} />
                <Route path="posthog" element={<TelemetrySection />} />
                <Route path="extras" element={<ExtrasSection />} />
                <Route
                  path="export-import"
                  element={<ExportImportSection />}
                />
              </Route>
            </Route>
          </Route>
        </Route>
      </Route>

      {/* 404 */}
      <Route path="*" element={<NotFoundPage />} />
    </Route>,
  ),
);

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/* Singleton SVG turbulence filter referenced by every
            <HighlighterMark>. Mounted at the app root so both the
            landing surface and the app-shell nav can use the
            highlighter wash without duplicating filter IDs in the DOM. */}
        <HighlighterMarkFilter />
        {/* Stale-bundle self-recovery — polls /version.json and prompts
            a reload when a new ornn-web has been deployed. Renders
            nothing on the happy path. */}
        <VersionUpdateBanner />
        <Suspense fallback={<RouteFallback />}>
          <RouterProvider router={router} />
        </Suspense>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
