/**
 * Main Application Component.
 * Configures routing and global providers.
 * @module App
 */

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RootLayout } from "@/components/layout/RootLayout";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { AdminGuard } from "@/components/auth/AdminGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Public pages
import { LoginPage } from "@/pages/LoginPage";
import { OAuthCallbackPage } from "@/pages/OAuthCallbackPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { LandingPage } from "@/pages/LandingPage";
import { DocsPage } from "@/pages/DocsPage";

// Protected pages
import { ExplorePage } from "@/pages/ExplorePage";
import { SkillDetailPage } from "@/pages/SkillDetailPage";
import { UploadSkillPage } from "@/pages/UploadSkillPage";
import { CreateSkillGuidedPage } from "@/pages/CreateSkillGuidedPage";
import { CreateSkillFreePage } from "@/pages/CreateSkillFreePage";
import { CreateSkillGenerativePage } from "@/pages/CreateSkillGenerativePage";
import { EditSkillPage } from "@/pages/EditSkillPage";
import { PlaygroundPage } from "@/pages/PlaygroundPage";

import { MySkillsPage } from "@/pages/MySkillsPage";

// Admin pages
import {
  CategoriesPage as AdminCategoriesPage,
  TagsPage as AdminTagsPage,
  DashboardPage as AdminDashboardPage,
  ActivitiesPage as AdminActivitiesPage,
  UsersPage as AdminUsersPage,
  AdminSkillsPage,
} from "@/pages/admin";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
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
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
