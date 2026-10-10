import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMarkdownFile,
  newMarkdownFileDirectory,
} from "./new-markdown-file.js";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-new-file-")),
  );
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/** Moves the file aside, as the Trash would. */
function recordingTrash(trashed: string[]) {
  return async (filePath: string) => {
    trashed.push(filePath);
    fs.renameSync(filePath, `${filePath}.trashed`);
  };
}

describe("newMarkdownFileDirectory", () => {
  const origin = "http://127.0.0.1:7373";

  it("starts in the active document's folder", () => {
    const url = `${origin}/?path=${encodeURIComponent("/Users/me/notes/plan.md")}`;

    expect(
      newMarkdownFileDirectory(url, ["/Users/me/other/x.md"], "/Users/me"),
    ).toBe("/Users/me/notes");
  });

  it("falls back to the most recent document, then the fallback folder", () => {
    expect(
      newMarkdownFileDirectory(`${origin}/`, ["/Users/me/other/x.md"], "/d"),
    ).toBe("/Users/me/other");
    expect(newMarkdownFileDirectory("about:blank", [], "/d")).toBe("/d");
  });
});

describe("createMarkdownFile", () => {
  it("creates an empty file, adding the .md extension when it is missing", async () => {
    const trashed: string[] = [];

    const created = await createMarkdownFile(
      path.join(tempDir, "ideas"),
      recordingTrash(trashed),
    );

    expect(created).toBe(path.join(tempDir, "ideas.md"));
    expect(fs.readFileSync(created, "utf8")).toBe("");
    expect(trashed).toEqual([]);
  });

  it("moves a file the dialog agreed to replace to the Trash first", async () => {
    const existing = path.join(tempDir, "plan.md");
    fs.writeFileSync(existing, "# Old plan\n");
    const trashed: string[] = [];

    await createMarkdownFile(existing, recordingTrash(trashed));

    expect(trashed).toEqual([existing]);
    expect(fs.readFileSync(existing, "utf8")).toBe("");
    expect(fs.readFileSync(`${existing}.trashed`, "utf8")).toBe("# Old plan\n");
  });

  it("never replaces a file the dialog did not ask about", async () => {
    const existing = path.join(tempDir, "plan.md");
    fs.writeFileSync(existing, "# Plan\n");
    const trashed: string[] = [];

    await expect(
      createMarkdownFile(path.join(tempDir, "plan"), recordingTrash(trashed)),
    ).rejects.toThrow("plan.md already exists.");
    expect(trashed).toEqual([]);
    expect(fs.readFileSync(existing, "utf8")).toBe("# Plan\n");
  });
});
