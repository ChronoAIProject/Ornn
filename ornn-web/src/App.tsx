/**
 * Main Application Component.
 * Configures routing and global providers. All page components are
 * route-level code-split via React.lazy so the initial bundle stays
 * lean — admin / editor / playground chunks only load when their
 * routes are visited.
 * @module App
 */

import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RootLayout } from "@/components/layout/RootLayout";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { AdminGuard } from "@/components/auth/AdminGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";

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

const ExplorePage = lazy(() =>
  import("@/pages/ExplorePage").then((m) => ({ default: m.ExplorePage })),
);
const SkillDetailPage = lazy(() =>
  import("@/pages/SkillDetailPage").then((m) => ({ default: m.SkillDetailPage })),
);
const UploadSkillPage = lazy(() =>
  import("@/pages/UploadSkillPage").then((m) => ({ default: m.UploadSkillPage })),
);
const CreateSkillGuidedPage = lazy(() =>
  import("@/pages/CreateSkillGuidedPage").then((m) => ({ default: m.CreateSkillGuidedPage })),
);
const CreateSkillFreePage = lazy(() =>
  import("@/pages/CreateSkillFreePage").then((m) => ({ default: m.CreateSkillFreePage })),
);
const CreateSkillGenerativePage = lazy(() =>
  import("@/pages/CreateSkillGenerativePage").then((m) => ({ default: m.CreateSkillGenerativePage })),
);
const EditSkillPage = lazy(() =>
  import("@/pages/EditSkillPage").then((m) => ({ default: m.EditSkillPage })),
);
const PlaygroundPage = lazy(() =>
  import("@/pages/PlaygroundPage").then((m) => ({ default: m.PlaygroundPage })),
);
const MySkillsPage = lazy(() =>
  import("@/pages/MySkillsPage").then((m) => ({ default: m.MySkillsPage })),
);
const ServiceDetailPage = lazy(() =>
  import("@/pages/ServiceDetailPage").then((m) => ({ default: m.ServiceDetailPage })),
);
const NotificationsPage = lazy(() =>
  import("@/pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage })),
);

// Admin pages — bundled into one chunk by virtue of sharing the barrel
// import path; only loaded when an /admin route activates.
const AdminDashboardPage = lazy(() =>
  import("@/pages/admin").then((m) => ({ default: m.DashboardPage })),
);
const AdminActivitiesPage = lazy(() =>
  import("@/pages/admin").then((m) => ({ default: m.ActivitiesPage })),
);
const AdminUsersPage = lazy(() =>
  import("@/pages/admin").then((m) => ({ default: m.UsersPage })),
);
const AdminSkillsPage = lazy(() =>
  import("@/pages/admin").then((m) => ({ default: m.AdminSkillsPage })),
);
const AdminCategoriesPage = lazy(() =>
  import("@/pages/admin").then((m) => ({ default: m.CategoriesPage })),
);
const AdminTagsPage = lazy(() =>
  import("@/pages/admin").then((m) => ({ default: m.TagsPage })),
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
  return <div className="p-8 text-text-muted text-sm">Loading…</div>;
}

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* Public routes (no auth) */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/oauth/callback" element={<OAuthCallbackPage />} />

              {/* Public routes with RootLayout */}
              <Route element={<RootLayout />}>
                <Route path="/" element={<LandingPage />} />
                <Route path="/docs" element={<DocsPage />} />
                <Route path="/registry" element={<ExplorePage />} />
                <Route path="/skills/:idOrName" element={<SkillDetailPage />} />
              </Route>

              {/* Protected routes */}
              <Route element={<AuthGuard />}>
                <Route element={<RootLayout />}>
                  <Route path="/skills/new" element={<UploadSkillPage />} />
                  <Route path="/skills/new/guided" element={<CreateSkillGuidedPage />} />
                  <Route path="/skills/new/free" element={<CreateSkillFreePage />} />
                  <Route path="/skills/new/generate" element={<CreateSkillGenerativePage />} />
                  <Route path="/skills/:id/edit" element={<EditSkillPage />} />
                  <Route path="/playground" element={<PlaygroundPage />} />

                  <Route path="/my-skills" element={<MySkillsPage />} />
                  <Route path="/services/:id" element={<ServiceDetailPage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                </Route>

                {/* Admin routes - separate layout */}
                <Route element={<AdminGuard />}>
                  <Route element={<AdminLayout />}>
                    <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
                    <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
                    <Route path="/admin/activities" element={<AdminActivitiesPage />} />
                    <Route path="/admin/users" element={<AdminUsersPage />} />
                    <Route path="/admin/skills" element={<AdminSkillsPage />} />
                    <Route path="/admin/categories" element={<AdminCategoriesPage />} />
                    <Route path="/admin/tags" element={<AdminTagsPage />} />
                  </Route>
                </Route>
              </Route>

              {/* 404 */}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
