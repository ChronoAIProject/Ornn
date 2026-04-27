---
"ornn-web": patch
---

refactor: migrate `App.tsx` to RR7's data router (#103). `BrowserRouter + Routes + Route` is replaced with `createBrowserRouter(createRoutesFromElements(...))` + `<RouterProvider>`. The route tree itself is still authored as JSX so the diff is minimal — every route, layout, guard, and code-split target is preserved exactly. Loaders / actions are NOT introduced in this PR; that's per-route work that can land separately when a clear win surfaces. Suspense fallback wraps the RouterProvider so existing `lazy()` chunks keep working unchanged.
