import { describe, expect, it } from "vitest";
import { shouldSuppressNativeDocumentShortcut } from "./document-shortcuts.js";

const commandW = {
  type: "keyDown",
  key: "w",
  code: "KeyW",
  meta: true,
  alt: false,
  control: false,
  shift: false,
  isAutoRepeat: false,
  isComposing: false,
};

describe("desktop document shortcuts", () => {
  it("routes Command-W to an open local document", () => {
    expect(
      shouldSuppressNativeDocumentShortcut(
        commandW,
        "http://localhost:7373/?path=%2Ftmp%2Fdraft.md",
        "http://localhost:7373",
      ),
    ).toBe(true);
  });

  it("routes Command-Shift-W to the document renderer for close-all confirmation", () => {
    expect(
      shouldSuppressNativeDocumentShortcut(
        { ...commandW, shift: true },
        "http://localhost:7373/?path=%2Ftmp%2Fdraft.md",
        "http://localhost:7373",
      ),
    ).toBe(true);
  });

  it("keeps native close suppressed for repeats and composition", () => {
    const url = "http://localhost:7373/?path=x.md";
    const origin = "http://localhost:7373";

    expect(
      shouldSuppressNativeDocumentShortcut(
        { ...commandW, isAutoRepeat: true },
        url,
        origin,
      ),
    ).toBe(true);
    expect(
      shouldSuppressNativeDocumentShortcut(
        { ...commandW, isComposing: true },
        url,
        origin,
      ),
    ).toBe(true);
    expect(
      shouldSuppressNativeDocumentShortcut(
        { ...commandW, type: "keyUp" },
        url,
        origin,
      ),
    ).toBe(false);
  });

  it("matches the layout-aware key rather than its physical code", () => {
    const url = "http://localhost:7373/?path=x.md";
    const origin = "http://localhost:7373";

    expect(
      shouldSuppressNativeDocumentShortcut(
        { ...commandW, code: "KeyZ" },
        url,
        origin,
      ),
    ).toBe(true);
    expect(
      shouldSuppressNativeDocumentShortcut(
        { ...commandW, key: "z" },
        url,
        origin,
      ),
    ).toBe(false);
  });

  it.each([
    ["the homepage", commandW, "http://localhost:7373/"],
    [
      "a key-up",
      { ...commandW, type: "keyUp" },
      "http://localhost:7373/?path=x.md",
    ],
    ["another origin", commandW, "http://example.com/?path=x.md"],
  ])("does not route %s", (_label, input, url) => {
    expect(
      shouldSuppressNativeDocumentShortcut(input, url, "http://localhost:7373"),
    ).toBe(false);
  });

  it.each([
    ["Command-F", { ...commandW, key: "f", code: "KeyF" }],
    ["Command-G", { ...commandW, key: "g", code: "KeyG" }],
    ["Command-Shift-G", { ...commandW, key: "g", code: "KeyG", shift: true }],
  ])("routes %s to the document renderer", (_label, input) => {
    expect(
      shouldSuppressNativeDocumentShortcut(
        input,
        "http://localhost:7373/?path=%2Ftmp%2Fdraft.md",
        "http://localhost:7373",
      ),
    ).toBe(true);
  });
});
