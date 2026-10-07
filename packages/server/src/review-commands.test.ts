import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  extractRoughdraftReviewIndex,
  validateRoughdraftMarkdown,
} from "@roughdraft/rfm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCliDependencies, runCli } from "./cli.js";

const inlineParent =
  'Please revisit {==this sentence==}{>>Needs a source.<<}{id="c1" by="user" at="2026-10-07T08:00:00.000Z"}.\n';
const compactParent = [
  "Please revisit {==this sentence==}{>>Needs a source.<<}{#c1}.",
  "",
  "---",
  "comments:",
  "  c1:",
  "    by: user",
  '    at: "2026-10-07T08:00:00.000Z"',
  "",
].join("\n");

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-review-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeDraft(markdown: string): string {
  const draftPath = path.join(dir, "draft.md");
  fs.writeFileSync(draftPath, markdown);
  return draftPath;
}

async function run(args: string[], stdin: string | null = null) {
  const logs: string[] = [];
  const errors: string[] = [];
  const exitCode = await runCli(
    args,
    createCliDependencies({
      cwd: dir,
      log: (message) => logs.push(message),
      error: (message) => errors.push(message),
      readStdin: async () => stdin,
    }),
  );
  return { exitCode, logs, errors };
}

function replyTo(markdown: string, parentId: string) {
  return extractRoughdraftReviewIndex(markdown).items.filter(
    (item) => item.parentId === parentId,
  );
}

describe("roughdraft reply", () => {
  it("adds an inline reply to an inline-attribute comment", async () => {
    const draftPath = writeDraft(inlineParent);

    const result = await run([
      "reply",
      draftPath,
      "--to",
      "c1",
      "--by",
      "Claude",
      "--body",
      "Added a source.",
    ]);

    const markdown = fs.readFileSync(draftPath, "utf8");
    expect(result.exitCode).toBe(0);
    expect(result.logs).toEqual(["Added reply c2 to c1."]);
    expect(markdown).toMatch(/\{>>Added a source\.<<\}\{id="c2" by="Claude"/);
    expect(replyTo(markdown, "c1")).toMatchObject([
      { id: "c2", author: "Claude", text: "Added a source." },
    ]);
  });

  it("adds an endmatter reply to a compact-reference comment", async () => {
    const draftPath = writeDraft(compactParent);

    const result = await run(["reply", draftPath, "--to", "c1"], "Done.\n");

    const markdown = fs.readFileSync(draftPath, "utf8");
    expect(result.exitCode).toBe(0);
    expect(markdown).toContain("  c2:\n    body: Done.\n    by: AI\n");
    expect(validateRoughdraftMarkdown(markdown).summary).toMatchObject({
      comments: 2,
      replies: 1,
    });
  });

  it("keeps quotes, colons, braces and blank lines from stdin intact", async () => {
    const draftPath = writeDraft(compactParent);
    const body = 'Fixed: the "intro" now cites {source}.\n\nSecond paragraph.';

    const result = await run(
      ["reply", draftPath, "--to", "c1", "--json"],
      `${body}\n`,
    );

    const markdown = fs.readFileSync(draftPath, "utf8");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.logs[0] ?? "{}")).toMatchObject({
      ok: true,
      id: "c2",
      parentId: "c1",
    });
    expect(replyTo(markdown, "c1")[0]?.text).toBe(body);
    expect(validateRoughdraftMarkdown(markdown).ok).toBe(true);
  });

  it("puts a multi-paragraph reply to an inline comment in endmatter", async () => {
    const draftPath = writeDraft(inlineParent);
    const body = "First paragraph.\n\nSecond paragraph.";

    const result = await run(["reply", draftPath, "--to", "c1"], body);

    const markdown = fs.readFileSync(draftPath, "utf8");
    expect(result.exitCode).toBe(0);
    expect(markdown.startsWith(inlineParent)).toBe(true);
    expect(replyTo(markdown, "c1")[0]?.text).toBe(body);
    expect(validateRoughdraftMarkdown(markdown).ok).toBe(true);
  });

  it("refuses a missing parent without touching the file", async () => {
    const draftPath = writeDraft(inlineParent);

    const result = await run(
      ["reply", draftPath, "--to", "c9", "--body", "Hello"],
      null,
    );

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual(["Review item not found: c9"]);
    expect(fs.readFileSync(draftPath, "utf8")).toBe(inlineParent);
  });

  it("requires reply text", async () => {
    const draftPath = writeDraft(inlineParent);

    const result = await run(["reply", draftPath, "--to", "c1"], null);

    expect(result.exitCode).toBe(2);
    expect(result.errors).toEqual([
      "Provide the reply text with --body or on stdin.",
    ]);
  });
});

describe("roughdraft comments", () => {
  it("prints threads with anchors and replies indented", async () => {
    const draftPath = writeDraft(
      [
        inlineParent.trimEnd(),
        "",
        "---",
        "comments:",
        "  c2:",
        "    body: Added a source.",
        "    by: Claude",
        '    at: "2026-10-07T09:00:00.000Z"',
        "    re: c1",
        "",
      ].join("\n"),
    );

    const result = await run(["comments", draftPath]);

    expect(result.exitCode).toBe(0);
    expect(result.logs).toEqual([
      'c1, by user, line 1 on "this sentence": Needs a source.',
      "  c2, by Claude: Added a source.",
    ]);
  });

  it("hides resolved items with --unresolved", async () => {
    const draftPath = writeDraft(
      'One {>>Done already<<}{id="c1" by="user" at="2026-10-07T08:00:00.000Z" status="resolved"} two {>>Still open<<}{id="c2" by="user" at="2026-10-07T08:01:00.000Z"}.\n',
    );

    const result = await run(["comments", draftPath, "--unresolved", "--json"]);

    const payload = JSON.parse(result.logs.join("\n")) as {
      items: Array<{ id: string }>;
    };
    expect(payload.items.map((item) => item.id)).toEqual(["c2"]);
  });
});

describe("roughdraft comments --unresolved", () => {
  it("hides replies to a resolved comment", async () => {
    const draftPath = writeDraft(
      'One {>>Done already<<}{id="c1" by="user" at="2026-10-07T08:00:00.000Z" status="resolved"}{>>Agreed<<}{id="c2" by="AI" at="2026-10-07T08:01:00.000Z" re="c1"} two {>>Open<<}{id="c3" by="user" at="2026-10-07T08:02:00.000Z"}.\n',
    );

    const result = await run(["comments", draftPath, "--unresolved"]);

    expect(result.logs).toEqual(["c3, by user, line 1: Open"]);
  });
});

describe("roughdraft resolve", () => {
  it("marks an inline comment resolved with a summary", async () => {
    const draftPath = writeDraft(inlineParent);

    const result = await run([
      "resolve",
      draftPath,
      "c1",
      "--summary",
      "Source added",
    ]);

    const markdown = fs.readFileSync(draftPath, "utf8");
    expect(result.exitCode).toBe(0);
    expect(result.logs).toEqual(["Resolved c1."]);
    expect(extractRoughdraftReviewIndex(markdown).items[0]?.status).toBe(
      "resolved",
    );
  });
});
