import { SkillCard } from "./SkillCard";
import { CatalogRow } from "./CatalogRow";
import { HammeredDivider } from "./HammeredDivider";
import { EmberLink } from "./EmberButton";
import { HighlighterMark } from "./HighlighterMark";
import { useCatalogSkills, useFeaturedSkills } from "./useFeaturedSkills";
import { CATALOG_DEFAULT, FEATURED_DEFAULT } from "./skillsData";

export function FeaturedSkillsSection() {
  const featured = useFeaturedSkills();
  const catalog = useCatalogSkills();

  const featuredItems = featured.data?.length ? featured.data : FEATURED_DEFAULT;
  const catalogItems = catalog.data?.length ? catalog.data : CATALOG_DEFAULT;

  return (
    <section
      id="browse"
      className="relative scroll-mt-16 border-t border-[color:var(--color-border-subtle)] bg-graphite py-20 sm:py-32"
    >
      <div className="mx-auto max-w-[1280px] px-6 sm:px-8">
        <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 className="font-display-grotesk text-[clamp(36px,4vw,56px)] font-bold uppercase leading-[0.98] tracking-[-0.025em] text-parchment">
              Skills, <HighlighterMark variant="gold">freshly forged</HighlighterMark>.
            </h2>
          </div>
          <EmberLink to="/registry" variant="ghost">
            See all →
          </EmberLink>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {featuredItems.map((s) => (
            <SkillCard key={s.slug} skill={s} />
          ))}
        </div>

        <HammeredDivider className="my-16" />

        <div className="mb-5 font-mono text-[10px] uppercase tracking-[0.25em] text-meta">
          Also on the registry
        </div>
        <div>
          {catalogItems.map((s, i) => (
            <CatalogRow
              key={s.name}
              skill={s}
              isLast={i === catalogItems.length - 1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
