/**
 * Tests for frontmatter parser.
 * Covers nested YAML parsing, old flat backward compat, malformed YAML, strip.
 */

import { describe, it, expect } from "vitest";
import { extractFrontmatter, stripFrontmatter } from "./frontmatter";

describe("extractFrontmatter", () => {
  it("parse_nestedMetadata_succeeds", () => {
    const md = `---
name: my-skill
description: A test skill
license: MIT
compatibility: claude-code >= 1.0
metadata:
  category: runtime-based
  runtime:
    - node
  runtime-dependency:
    - axios
  runtime-env-var:
    - API_KEY
  tag:
    - automation
---

# My Skill
`;

    const result = extractFrontmatter(md);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("my-skill");
    expect(result!.description).toBe("A test skill");
    expect(result!.license).toBe("MIT");
    expect(result!.compatibility).toBe("claude-code >= 1.0");
    expect(result!.metadata.category).toBe("runtime-based");
    expect(result!.metadata.runtime).toEqual(["node"]);
    expect(result!.metadata.runtimeDependency).toEqual(["axios"]);
    expect(result!.metadata.runtimeEnvVar).toEqual(["API_KEY"]);
    expect(result!.metadata.tag).toEqual(["automation"]);
  });

  it("parse_nestedWithClaudeFields_succeeds", () => {
    const md = `---
name: my-skill
description: Test
disable-model-invocation: true
user-invocable: false
allowed-tools:
  - Bash
argument-hint: provide a file
metadata:
  category: plain
---

# Test
`;

    const result = extractFrontmatter(md);
    expect(result).not.toBeNull();
    expect(result!.disableModelInvocation).toBe(true);
    expect(result!.userInvocable).toBe(false);
    expect(result!.allowedTools).toEqual(["Bash"]);
    expect(result!.argumentHint).toBe("provide a file");
  });

  it("parse_oldFlatFrontmatter_autoMapsToNested", () => {
    const md = `---
name: old-skill
description: Old format
category: tools_required
tools:
  - Bash
  - Write
tags:
  - dev
---

# Old Skill
`;

    const result = extractFrontmatter(md);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("old-skill");
    expect(result!.metadata).toBeDefined();
    expect(result!.metadata.category).toBe("tool-based");
    expect(result!.metadata.toolList).toEqual(["Bash", "Write"]);
    expect(result!.metadata.tag).toEqual(["dev"]);
  });

  it("parse_oldFlatWithRuntimes_autoMaps", () => {
    const md = `---
name: runtime-skill
description: Old runtime format
category: runtime_required
runtimes:
  - node
env:
  - API_KEY
dependencies:
  - axios
---

# Runtime Skill
`;

    const result = extractFrontmatter(md);
    expect(result).not.toBeNull();
    expect(result!.metadata.category).toBe("runtime-based");
    expect(result!.metadata.runtime).toEqual(["node"]);
    expect(result!.metadata.runtimeEnvVar).toEqual(["API_KEY"]);
    expect(result!.metadata.runtimeDependency).toEqual(["axios"]);
  });

  it("parse_oldFlatWithNpmDependencies_autoMaps", () => {
    const md = `---
name: upload-to-s3
description: Upload files to AWS S3
tools:
  - Bash
  - Write
dependencies:
  - "@aws-sdk/client-s3"
env:
  - AWS_ACCESS_KEY_ID
  - AWS_SECRET_ACCESS_KEY
---

# Upload to S3

Some content here.
`;

    const result = extractFrontmatter(md);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("upload-to-s3");
    expect(result!.metadata.toolList).toEqual(["Bash", "Write"]);
    expect(result!.metadata.runtimeDependency).toEqual(["@aws-sdk/client-s3"]);
    expect(result!.metadata.runtimeEnvVar).toEqual([
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
    ]);
  });

  it("parse_noFrontmatter_returnsNull", () => {
    const result = extractFrontmatter("# Just markdown\nNo frontmatter here.");
    expect(result).toBeNull();
  });

  it("parse_malformedYaml_returnsNull", () => {
    const md = `---
name: [invalid
  yaml: {broken
---

# Bad YAML
`;

    const result = extractFrontmatter(md);
    expect(result).toBeNull();
  });

  it("parse_emptyFrontmatter_returnsNull", () => {
    const md = `---
---

# Empty
`;
    const result = extractFrontmatter(md);
    expect(result).toBeNull();
  });

  it("parse_windowsLineEndings_normalized", () => {
    const md =
      "---\r\nname: test\r\ndescription: test\r\nmetadata:\r\n  category: plain\r\n---\r\n\r\n# Test";
    const result = extractFrontmatter(md);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("test");
  });

  it("parse_quotedValues_handledCorrectly", () => {
    const md = `---
name: "quoted-name"
description: "A quoted description"
metadata:
  category: "plain"
---

# Test
`;

    const result = extractFrontmatter(md);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("quoted-name");
    expect(result!.description).toBe("A quoted description");
  });

  it("parse_emptyToolsArray_returnsEmptyArray", () => {
    const md = `---
name: simple-skill
description: A simple skill
metadata:
  category: plain
---

# Simple
`;
    const result = extractFrontmatter(md);
    expect(result).not.toBeNull();
    expect(result!.metadata.toolList).toBeUndefined();
  });
});

describe("stripFrontmatter", () => {
  it("strip_withFrontmatter_returnsBody", () => {
    const md = `---
name: test
description: test
---

# Body Content

Some text here.`;

    const result = stripFrontmatter(md);
    expect(result).toBe("# Body Content\n\nSome text here.");
    expect(result).not.toContain("---");
  });

  it("strip_noFrontmatter_returnsAll", () => {
    const md = "# Just a heading";
    expect(stripFrontmatter(md)).toBe("# Just a heading");
  });
});
