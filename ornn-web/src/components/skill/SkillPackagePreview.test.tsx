/**
 * SkillPackagePreview tests — derived selection fallback (#888).
 *
 * The viewer derives the effective file selection during render instead
 * of seeding it via an effect: `userSelectedFileId` wins only while its
 * contents still exist in `fileContents`; otherwise it falls back to the
 * default file (SKILL.md, else first file). So a user pick that vanishes
 * across a version-switch / delete must silently degrade to the default
 * without crashing.
 *
 * STALE-STATE-FIRST oracle: select a non-default file (so the explicit
 * pick is "wrong" relative to the default), then rerender with that file
 * removed from `fileContents` → the derived selection self-corrects to
 * the default and the viewer renders the default's content, no crash.
 *
 * FileTree wraps folder children in framer-motion AnimatePresence; we use
 * top-level files only AND stub framer-motion pass-through so nothing is
 * gated behind an unresolved exit animation. react-i18next is stubbed
 * globally in src/test/setup.ts.
 *
 * @module components/skill/SkillPackagePreview.test
 */

import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FileNode } from "@/components/editor/FileTree";
import type { SkillMetadata } from "@/types/skillPackage";

// Pass-through framer-motion so AnimatePresence honours unmount synchronously
// (see FileTree.test.tsx for the rationale — the real one keeps exiting
// children mounted without rAF in jsdom).
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({
          children,
          initial: _i,
          animate: _a,
          exit: _e,
          transition: _tr,
          ...rest
        }: Record<string, unknown> & { children?: React.ReactNode }) => {
          void _i;
          void _a;
          void _e;
          void _tr;
          const Tag = tag as keyof React.JSX.IntrinsicElements;
          return <Tag {...rest}>{children}</Tag>;
        },
    },
  ),
}));

import { SkillPackagePreview } from "./SkillPackagePreview";

const FILES: FileNode[] = [
  { id: "SKILL.md", name: "SKILL.md", type: "file" },
  { id: "reference.md", name: "reference.md", type: "file" },
];

function contents(map: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(map));
}

const METADATA: SkillMetadata = {
  name: "demo-skill",
  description: "A demo skill",
  metadata: { category: "utility", tag: ["demo"] },
} as unknown as SkillMetadata;

afterEach(() => {
  cleanup();
});

describe("SkillPackagePreview — derived selection fallback", () => {
  it("defaults to SKILL.md content on first render", () => {
    render(
      <SkillPackagePreview
        files={FILES}
        fileContents={contents({
          "SKILL.md": "# Skill doc",
          "reference.md": "# Reference",
        })}
        metadata={METADATA}
      />,
    );
    // SKILL.md is the default; its content is shown in the viewer.
    expect(screen.getByText("# Skill doc")).toBeInTheDocument();
  });

  it("falls back to the default when the user's picked file is removed", () => {
    const { rerender } = render(
      <SkillPackagePreview
        files={FILES}
        fileContents={contents({
          "SKILL.md": "# Skill doc",
          "reference.md": "# Reference",
        })}
        metadata={METADATA}
      />,
    );

    // Explicitly pick the NON-default file (reference.md) so the derived
    // selection is driven by the user pick, diverging from the default.
    fireEvent.click(screen.getByText("reference.md"));
    expect(screen.getByText("# Reference")).toBeInTheDocument();

    // Version-switch: reference.md disappears from both the tree and the
    // contents map. The explicit pick now points at a vanished file.
    const nextFiles: FileNode[] = [{ id: "SKILL.md", name: "SKILL.md", type: "file" }];
    rerender(
      <SkillPackagePreview
        files={nextFiles}
        fileContents={contents({ "SKILL.md": "# Skill doc v2" })}
        metadata={METADATA}
      />,
    );

    // Derived selection self-corrects to SKILL.md — its (new) content shows,
    // and the stale reference.md content is gone. No crash.
    expect(screen.getByText("# Skill doc v2")).toBeInTheDocument();
    expect(screen.queryByText("# Reference")).not.toBeInTheDocument();
  });

  it("renders the empty-selection placeholder when no files exist", () => {
    render(
      <SkillPackagePreview
        files={[]}
        fileContents={contents({})}
        metadata={METADATA}
      />,
    );
    // findDefaultFileId returns undefined → no file selected → placeholder.
    expect(
      screen.getByText("Select a file to view its content"),
    ).toBeInTheDocument();
  });
});
