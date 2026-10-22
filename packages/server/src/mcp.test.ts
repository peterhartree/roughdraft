import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callTool } from "./mcp";

describe("mcp", () => {
  let tempDir: string;
  let projectDir: string;
  let documentPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-mcp-"));
    projectDir = path.join(tempDir, "project");
    documentPath = path.join(projectDir, "draft.md");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(documentPath, "# Draft\n");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not write a reply when the message contains a CriticMarkup close delimiter", async () => {
    const original =
      '# Draft\n\n{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}\n';
    fs.writeFileSync(documentPath, original);

    await expect(
      callTool("roughdraft_reply_to_comment", {
        documentPath,
        parentId: "c1",
        message: "This closes early <<} and breaks parsing.",
      }),
    ).rejects.toThrow(/CriticMarkup close delimiter/);

    expect(fs.readFileSync(documentPath, "utf8")).toBe(original);
  });

  it("resolves a thread by removing it, keeping the highlighted text", async () => {
    fs.writeFileSync(
      documentPath,
      [
        "# Draft",
        "",
        "Keep {==this claim==}{>>Needs proof<<}{#c1} as written.",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "  c2:",
        "    body: Added it.",
        "    by: AI",
        '    at: "2026-04-28T12:05:00.000Z"',
        "    re: c1",
        "",
      ].join("\n"),
    );

    const result = await callTool("roughdraft_resolve_thread", {
      documentPath,
      targetId: "c2",
    });

    expect(result).toMatchObject({ threads: ["c1"], removed: ["c1", "c2"] });
    expect(fs.readFileSync(documentPath, "utf8")).toBe(
      "# Draft\n\nKeep this claim as written.\n",
    );
  });
});
