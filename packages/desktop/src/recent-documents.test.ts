import { describe, expect, it } from "vitest";
import { parseRecentDocumentPaths } from "./recent-documents.js";

describe("recent document paths from the renderer", () => {
  it("accepts absolute Markdown paths in order, dropping repeats", () => {
    expect(
      parseRecentDocumentPaths([
        "/Users/me/b.md",
        "/Users/me/a.MD",
        "/Users/me/b.md",
      ]),
    ).toEqual(["/Users/me/b.md", "/Users/me/a.MD"]);
  });

  it.each([
    ["a non-array", "/Users/me/a.md"],
    ["a relative path", ["notes/a.md"]],
    ["a non-Markdown file", ["/Users/me/a.txt"]],
    ["a non-string entry", [42]],
    [
      "more than twenty entries",
      Array.from({ length: 21 }, (_, i) => `/r/${i}.md`),
    ],
  ])("rejects %s", (_description, value) => {
    expect(parseRecentDocumentPaths(value)).toBeNull();
  });
});
