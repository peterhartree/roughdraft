import { describe, expect, it } from "vitest";
import {
  buildDocumentOutline,
  filterDocumentOutline,
  getActiveOutlineItemIndex,
  getDocumentOutlineMarginLayout,
  isDocumentOutlinePaletteShortcut,
  readDocumentOutlineCollapsed,
  writeDocumentOutlineCollapsed,
} from "./document-outline";

const h = (level: number, text: string) => ({ level, text });

describe("buildDocumentOutline", () => {
  it("leaves out a single leading H1 as the document title", () => {
    const outline = buildDocumentOutline([
      h(1, "How the team thinks about strategy"),
      h(2, "Summary"),
      h(3, "1. The main bet"),
      h(2, "Open questions"),
    ]);

    expect(outline.map((item) => [item.depth, item.text])).toEqual([
      [0, "Summary"],
      [1, "1. The main bet"],
      [0, "Open questions"],
    ]);
    expect(outline[0].headingIndex).toBe(1);
  });

  it("keeps H1s when the document has several of them", () => {
    const outline = buildDocumentOutline([
      h(1, "Part one"),
      h(2, "Detail"),
      h(1, "Part two"),
    ]);

    expect(outline.map((item) => [item.depth, item.text])).toEqual([
      [0, "Part one"],
      [1, "Detail"],
      [0, "Part two"],
    ]);
  });

  it("indents by the levels present, so skipped levels do not leave gaps", () => {
    const outline = buildDocumentOutline([h(2, "Section"), h(4, "Deep")]);

    expect(outline.map((item) => item.depth)).toEqual([0, 1]);
  });

  it("caps indentation at three levels", () => {
    const outline = buildDocumentOutline([
      h(2, "A"),
      h(3, "B"),
      h(4, "C"),
      h(5, "D"),
    ]);

    expect(outline.map((item) => item.depth)).toEqual([0, 1, 2, 2]);
  });

  it("records the enclosing heading for each item", () => {
    const outline = buildDocumentOutline([
      h(2, "Impact model"),
      h(3, "Four bets"),
      h(2, "Delivery"),
    ]);

    expect(outline.map((item) => item.parentText)).toEqual([
      null,
      "Impact model",
      null,
    ]);
  });

  it("skips empty headings and tidies whitespace", () => {
    const outline = buildDocumentOutline([
      h(2, "  "),
      h(2, " Spaced \n  out "),
    ]);

    expect(outline).toEqual([
      { headingIndex: 1, depth: 0, text: "Spaced out", parentText: null },
    ]);
  });
});

describe("getActiveOutlineItemIndex", () => {
  it("is the last heading above the reading line", () => {
    expect(getActiveOutlineItemIndex([100, 400, 900], 450)).toBe(1);
  });

  it("is nothing before the first heading", () => {
    expect(getActiveOutlineItemIndex([300, 600], 120)).toBe(-1);
  });
});

describe("getDocumentOutlineMarginLayout", () => {
  it("pins the outline when the margin fits it", () => {
    expect(getDocumentOutlineMarginLayout(365)).toEqual({
      mode: "pinned",
      width: 256,
    });
    expect(getDocumentOutlineMarginLayout(240)).toEqual({
      mode: "pinned",
      width: 200,
    });
  });

  it("widens the outline a little in a very wide margin", () => {
    expect(getDocumentOutlineMarginLayout(480)).toEqual({
      mode: "pinned",
      width: 256,
    });
    expect(getDocumentOutlineMarginLayout(640)).toEqual({
      mode: "pinned",
      width: 296,
    });
    expect(getDocumentOutlineMarginLayout(2000)).toEqual({
      mode: "pinned",
      width: 320,
    });
  });

  it("falls back to ticks when the margin is narrow", () => {
    expect(getDocumentOutlineMarginLayout(239)).toEqual({ mode: "ticks" });
  });
});

describe("filterDocumentOutline", () => {
  const outline = buildDocumentOutline([
    h(2, "The impact model"),
    h(3, "Three priorities"),
    h(2, "Delivery in detail"),
  ]);

  it("matches headings case-insensitively", () => {
    expect(
      filterDocumentOutline(outline, "DELIVERY").map((item) => item.text),
    ).toEqual(["Delivery in detail"]);
  });

  it("matches subsections by their parent heading", () => {
    expect(
      filterDocumentOutline(outline, "impact").map((item) => item.text),
    ).toEqual(["The impact model", "Three priorities"]);
  });

  it("returns everything for an empty query", () => {
    expect(filterDocumentOutline(outline, "  ")).toHaveLength(3);
  });
});

describe("isDocumentOutlinePaletteShortcut", () => {
  const event = {
    code: "KeyO",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
    repeat: false,
    isComposing: false,
  };

  it("matches Command+Shift+O", () => {
    expect(isDocumentOutlinePaletteShortcut(event)).toBe(true);
  });

  it("does not take Command+O, which opens a file", () => {
    expect(
      isDocumentOutlinePaletteShortcut({ ...event, shiftKey: false }),
    ).toBe(false);
  });

  it("ignores extra modifiers and key repeat", () => {
    expect(isDocumentOutlinePaletteShortcut({ ...event, altKey: true })).toBe(
      false,
    );
    expect(isDocumentOutlinePaletteShortcut({ ...event, repeat: true })).toBe(
      false,
    );
  });
});

describe("document outline collapsed preference", () => {
  function memoryStorage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
  }

  it("round-trips the collapsed choice", () => {
    const storage = memoryStorage();
    expect(readDocumentOutlineCollapsed(storage)).toBe(false);
    writeDocumentOutlineCollapsed(true, storage);
    expect(readDocumentOutlineCollapsed(storage)).toBe(true);
  });

  it("treats unreadable storage as not collapsed", () => {
    expect(
      readDocumentOutlineCollapsed({
        getItem: () => "{not json",
        setItem: () => {},
      }),
    ).toBe(false);
  });
});
