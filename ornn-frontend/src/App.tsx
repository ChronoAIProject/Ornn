/**
 * Main Application Component.
 * Configures routing and global providers.
 * @module App
 */

import { BrowserRouter, Routes, Route } from "react-router-dom";
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

// Protected pages
import { ExplorePage } from "@/pages/ExplorePage";
import { SkillDetailPage } from "@/pages/SkillDetailPage";
import { UploadSkillPage } from "@/pages/UploadSkillPage";
import { CreateSkillGuidedPage } from "@/pages/CreateSkillGuidedPage";
import { CreateSkillFreePage } from "@/pages/CreateSkillFreePage";
import { CreateSkillGenerativePage } from "@/pages/CreateSkillGenerativePage";
import { EditSkillPage } from "@/pages/EditSkillPage";
import { PlaygroundPage } from "@/pages/PlaygroundPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { MySkillsPage } from "@/pages/MySkillsPage";

// Admin pages
import {
  CategoriesPage as AdminCategoriesPage,
  TagsPage as AdminTagsPage,
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
            {/* Public routes */}
            <Route path="/landing" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/oauth/callback" element={<OAuthCallbackPage />} />

            {/* Protected routes */}
            <Route element={<AuthGuard />}>
              <Route element={<RootLayout />}>
                <Route path="/" element={<ExplorePage />} />
                <Route path="/skills/new" element={<UploadSkillPage />} />
                <Route path="/skills/new/guided" element={<CreateSkillGuidedPage />} />
                <Route path="/skills/new/free" element={<CreateSkillFreePage />} />
                <Route path="/skills/new/generate" element={<CreateSkillGenerativePage />} />
                <Route path="/skills/:idOrName" element={<SkillDetailPage />} />
                <Route path="/skills/:id/edit" element={<EditSkillPage />} />
                <Route path="/playground" element={<PlaygroundPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/my-skills" element={<MySkillsPage />} />
              </Route>

              {/* Admin routes - separate layout */}
              <Route element={<AdminGuard />}>
                <Route element={<AdminLayout />}>
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
