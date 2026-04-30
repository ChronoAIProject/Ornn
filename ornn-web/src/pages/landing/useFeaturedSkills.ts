import { useQuery } from "@tanstack/react-query";
import { searchSkills } from "@/services/searchApi";
import type { SkillSearchResult } from "@/types/search";
import {
  FEATURED_DEFAULT,
  CATALOG_DEFAULT,
  type FeaturedSkill,
  type CatalogSkill,
} from "./skillsData";

/**
 * Lazy overlay for the hardcoded FEATURED_DEFAULT cards.
 *
 * The landing always renders the hardcoded narrative first (zero-dependency,
 * zero-flash). Once the public search endpoint resolves with real skills, we
 * quietly replace the cards. If the endpoint 4xx/5xxs or returns empty, the
 * hardcoded defaults stay visible — no error UI on the landing.
 */
export function useFeaturedSkills() {
  return useQuery<FeaturedSkill[]>({
    queryKey: ["landing", "featured"],
    queryFn: async () => {
      try {
        const res = await searchSkills({
          mode: "keyword",
          scope: "public",
          pageSize: 3,
        });
        if (!res?.items?.length) return FEATURED_DEFAULT;
        return res.items.slice(0, 3).map(toFeatured);
      } catch {
        return FEATURED_DEFAULT;
      }
    },
    placeholderData: FEATURED_DEFAULT,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useCatalogSkills() {
  return useQuery<CatalogSkill[]>({
    queryKey: ["landing", "catalog"],
    queryFn: async () => {
      try {
        const res = await searchSkills({
          mode: "keyword",
          scope: "public",
          page: 2,
          pageSize: 5,
        });
        if (!res?.items?.length) return CATALOG_DEFAULT;
        return res.items.slice(0, 5).map((item, i) => toCatalog(item, i + 4));
      } catch {
        return CATALOG_DEFAULT;
      }
    },
    placeholderData: CATALOG_DEFAULT,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

function toFeatured(item: SkillSearchResult): FeaturedSkill {
  const tag = item.tags?.[0] ?? "skill";
  const owner = item.createdByDisplayName ?? item.createdBy ?? "@author";
  return {
    slug: item.name,
    tag: `FEATURED · ${tag}`,
    name: item.name,
    desc: item.description || "—",
    tags: item.tags ?? [],
    author: owner.startsWith("@") ? owner : `@${owner}`,
    version: "v 1.0.0",
    date: formatShortDate(item.updatedOn),
  };
}

function toCatalog(item: SkillSearchResult, num: number): CatalogSkill {
  const author =
    item.createdByDisplayName ?? item.createdBy ?? "author";
  const tagsLine = [`@${author.replace(/^@/, "")}`, ...(item.tags ?? []).slice(0, 3)].join(" · ");
  return {
    num: String(num).padStart(2, "0"),
    name: item.name,
    tags: tagsLine,
    purpose: item.description || "—",
    date: formatShortDate(item.updatedOn),
  };
}

function formatShortDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { day: "numeric", month: "short" });
}
