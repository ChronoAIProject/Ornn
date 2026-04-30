import { Outlet, useLocation, useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Navbar } from "./Navbar";
import { ToastContainer } from "@/components/ui/Toast";

/** Build breadcrumb segments from current route — every crumb is clickable */
function useBreadcrumbs() {
  const location = useLocation();
  const params = useParams();
  const { t } = useTranslation();
  const path = location.pathname;

  const crumbs: Array<{ label: string; to: string }> = [
    { label: t("breadcrumb.ornn"), to: "/" },
  ];

  const tab = new URLSearchParams(location.search).get("tab");

  if (path === "/registry") {
    crumbs.push(
      tab === "system"
        ? { label: "System Skills", to: "/registry?tab=system" }
        : tab === "my-skills"
        ? { label: t("breadcrumb.mySkills"), to: "/registry?tab=my-skills" }
        : { label: t("breadcrumb.publicSkills"), to: "/registry" }
    );
  } else if (path === "/my-skills") {
    crumbs.push({ label: t("breadcrumb.mySkills"), to: "/my-skills" });
  } else if (path.startsWith("/skills/new")) {
    crumbs.push({ label: t("breadcrumb.createSkill"), to: "/skills/new" });
    if (path === "/skills/new/guided") crumbs.push({ label: t("breadcrumb.guided"), to: "/skills/new/guided" });
    else if (path === "/skills/new/free") crumbs.push({ label: t("breadcrumb.upload"), to: "/skills/new/free" });
    else if (path === "/skills/new/generate") crumbs.push({ label: t("breadcrumb.generate"), to: "/skills/new/generate" });
  } else if (path.startsWith("/skills/") && params.idOrName) {
    crumbs.push({ label: params.idOrName, to: `/skills/${params.idOrName}` });
  } else if (path.startsWith("/skills/") && params.id) {
    crumbs.push({ label: t("breadcrumb.editSkill"), to: path });
  } else if (path === "/playground") {
    const skillName = new URLSearchParams(location.search).get("skill");
    if (skillName) {
      crumbs.push({ label: skillName, to: `/skills/${skillName}` });
      crumbs.push({ label: t("breadcrumb.playground"), to: `/playground?skill=${encodeURIComponent(skillName)}` });
    } else {
      crumbs.push({ label: t("breadcrumb.playground"), to: "/playground" });
    }
  } else if (path === "/services/my") {
    crumbs.push({ label: "My NyxID Services", to: "/services/my" });
  } else if (path === "/services/admin") {
    crumbs.push({ label: "Admin NyxID Services", to: "/services/admin" });
  } else if (path.match(/^\/services\/[^/]+$/)) {
    const source = new URLSearchParams(location.search).get("source");
    if (source === "my") {
      crumbs.push({ label: "My NyxID Services", to: "/services/my" });
    } else {
      crumbs.push({ label: "Admin NyxID Services", to: "/services/admin" });
    }
    crumbs.push({ label: "Service Detail", to: path });
  } else if (path === "/settings") {
    crumbs.push({ label: t("breadcrumb.settings"), to: "/settings" });
  } else if (path === "/docs") {
    const search = new URLSearchParams(location.search);
    const section = search.get("section");
    const title = search.get("title");
    crumbs.push({ label: t("breadcrumb.docs"), to: "/docs" });
    if (section) {
      const label = title || section.replace(/-/g, " ");
      crumbs.push({ label, to: `/docs?section=${section}${title ? `&title=${encodeURIComponent(title)}` : ""}` });
    }
  } else if (path.startsWith("/admin")) {
    crumbs.push({ label: t("breadcrumb.admin"), to: "/admin/categories" });
    if (path.includes("categories")) crumbs.push({ label: t("breadcrumb.categories"), to: "/admin/categories" });
    else if (path.includes("tags")) crumbs.push({ label: t("breadcrumb.tags"), to: "/admin/tags" });
  }

  return crumbs;
}

export function RootLayout() {
  const crumbs = useBreadcrumbs();

  return (
    <div className="flex flex-col h-screen bg-page bg-grid overflow-hidden">
      <Navbar />
      {/* Breadcrumb navigation — hide when only root crumb. Width matches
          LandingNav (max-w-[1280px] mx-auto px-6 sm:px-8) so app-shell
          horizontal rhythm aligns with the landing surface. */}
      {crumbs.length > 1 && (
      <div className="mx-auto w-full max-w-[1280px] shrink-0 px-6 sm:px-8 pt-3 pb-2">
        <nav className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em]">
          {crumbs.map((crumb, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && (
                  <span className="text-meta opacity-50 select-none">/</span>
                )}
                {isLast ? (
                  <span className="text-accent font-medium">
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    to={crumb.to ?? "#"}
                    className="text-meta hover:text-strong transition-colors duration-150"
                  >
                    {crumb.label}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>
      </div>
      )}
      <main className="mx-auto w-full max-w-[1280px] flex-1 min-h-0 px-6 sm:px-8 overflow-hidden">
        <Outlet />
      </main>
      <ToastContainer />
    </div>
  );
}
