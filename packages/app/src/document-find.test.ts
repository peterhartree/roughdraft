import { describe, expect, it } from "vitest";
import { findTextRanges, getDocumentFindActiveIndex } from "./document-find";

describe("document find", () => {
  it("finds case-insensitive, non-overlapping ranges", () => {
    expect(findTextRanges("Needle needle NEEDLE", "needle")).toEqual([
      { from: 0, to: 6 },
      { from: 7, to: 13 },
      { from: 14, to: 20 },
    ]);
    expect(findTextRanges("aaaa", "aa")).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });

  it("preserves document offsets and treats an empty query as no matches", () => {
    expect(findTextRanges("prefix needle", "needle", 10)).toEqual([
      { from: 17, to: 23 },
    ]);
    expect(findTextRanges("needle", "")).toEqual([]);
  });

  it("maps length-changing Unicode folds back to source offsets", () => {
    expect(findTextRanges("İx İX", "x")).toEqual([
      { from: 1, to: 2 },
      { from: 4, to: 5 },
    ]);
    expect(findTextRanges("İ", "i")).toEqual([{ from: 0, to: 1 }]);
  });

  it("resets and wraps next and previous navigation", () => {
    expect(getDocumentFindActiveIndex(-1, 3, "reset")).toBe(0);
    expect(getDocumentFindActiveIndex(0, 3, "next")).toBe(1);
    expect(getDocumentFindActiveIndex(2, 3, "next")).toBe(0);
    expect(getDocumentFindActiveIndex(0, 3, "previous")).toBe(2);
    expect(getDocumentFindActiveIndex(0, 0, "next")).toBe(-1);
  });
});
