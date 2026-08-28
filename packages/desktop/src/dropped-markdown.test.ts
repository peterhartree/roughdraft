import { describe, expect, it } from "vitest";
import { resolveDroppedMarkdownPath } from "./dropped-markdown.js";

describe("dropped Markdown files", () => {
  it("returns the first dropped .md path, case-insensitively", () => {
    const files = [
      { name: "notes.txt", path: "/tmp/notes.txt" },
      { name: "DRAFT.MD", path: "/tmp/DRAFT.MD" },
      { name: "other.md", path: "/tmp/other.md" },
    ];

    expect(resolveDroppedMarkdownPath(files, (file) => file.path)).toBe(
      "/tmp/DRAFT.MD",
    );
  });

  it("ignores files without a usable Markdown path", () => {
    const files = [
      { name: "draft.md", path: "" },
      { name: "notes.txt", path: "/tmp/notes.txt" },
    ];

    expect(resolveDroppedMarkdownPath(files, (file) => file.path)).toBeNull();
  });
});
