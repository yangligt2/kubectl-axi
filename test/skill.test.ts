import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import {
  createSkillMarkdown,
  extractCommandsBlock,
  HERMES_CATEGORY,
  HERMES_TAGS,
  SKILL_AUTHOR,
  SKILL_DESCRIPTION,
} from "../src/skill.js";

function parseFrontmatter(markdown: string): Record<string, unknown> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    throw new Error("Missing frontmatter");
  }
  return parse(match[1], { strict: true }) as Record<string, unknown>;
}

describe("createSkillMarkdown", () => {
  it("matches the committed skills/kubectl-axi/SKILL.md", () => {
    const committed = readFileSync(
      new URL("../skills/kubectl-axi/SKILL.md", import.meta.url),
      "utf8",
    );
    expect(committed).toBe(createSkillMarkdown());
  });

  it("starts with valid YAML frontmatter and is not user-invocable", () => {
    const frontmatter = parseFrontmatter(createSkillMarkdown());
    expect(frontmatter).toEqual({
      name: "kubectl-axi",
      description: SKILL_DESCRIPTION,
      "user-invocable": false,
      author: SKILL_AUTHOR,
      metadata: {
        hermes: {
          tags: HERMES_TAGS,
          category: HERMES_CATEGORY,
        },
      },
    });
  });

  it("teaches npx invocation instead of assuming a global install", () => {
    expect(createSkillMarkdown()).toContain("npx -y kubectl-axi");
  });

  it("documents the kubectl prerequisite and the read-only guarantee", () => {
    const markdown = createSkillMarkdown();
    expect(markdown).toContain("kubectl");
    expect(markdown).toContain("read-only");
  });

  it("carries no env-var requirements (auth rides on kubeconfig)", () => {
    const frontmatter = parseFrontmatter(createSkillMarkdown());
    expect(frontmatter).not.toHaveProperty("required_environment_variables");
  });
});

describe("extractCommandsBlock", () => {
  it("pulls the commands list from the top-level help", () => {
    const block = extractCommandsBlock();
    expect(block).toMatch(/^commands\[\d+\]:\n/);
    expect(block).toContain("triage");
    expect(block).toContain("setup");
  });
});
