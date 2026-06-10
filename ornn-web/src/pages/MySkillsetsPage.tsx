/**
 * MySkillsetsPage — thin wrapper that renders `SkillsetExplorePage` pinned to
 * the `mine` scope (route `/my-skillsets`). Mirrors how the skills `MySkills`
 * surface is a focused view of the registry. Owner Edit/Delete controls and
 * the "New skillset" CTA come from the pinned explore page.
 *
 * @module pages/MySkillsetsPage
 */

import { SkillsetExplorePage } from "@/pages/SkillsetExplorePage";

export function MySkillsetsPage() {
  return <SkillsetExplorePage pinScope="mine" />;
}
