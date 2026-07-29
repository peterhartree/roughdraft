import { describe, expect, it } from "vitest";
import {
  getDocumentFindShortcutAction,
  getInteractionModeShortcutTarget,
  matchesCopyPathShortcut,
} from "../src/workspace-shortcuts";

const shortcut = {
  code: "KeyS",
  key: "s",
  metaKey: true,
  altKey: true,
  ctrlKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  target: null,
};

describe("editing and suggesting shortcut", () => {
  it("toggles editing to suggesting", () => {
    expect(getInteractionModeShortcutTarget(shortcut, "editing")).toBe(
      "suggesting",
    );
  });

  it("toggles suggesting to editing", () => {
    expect(getInteractionModeShortcutTarget(shortcut, "suggesting")).toBe(
      "editing",
    );
  });

  it("leaves viewing mode unchanged", () => {
    expect(getInteractionModeShortcutTarget(shortcut, "viewing")).toBeNull();
  });

  it.each([
    { ...shortcut, metaKey: false },
    { ...shortcut, altKey: false },
    { ...shortcut, ctrlKey: true },
    { ...shortcut, shiftKey: true },
    { ...shortcut, code: "KeyX", key: "x" },
    { ...shortcut, repeat: true },
    { ...shortcut, isComposing: true },
  ])("ignores non-matching or unsafe key events", (event) => {
    expect(getInteractionModeShortcutTarget(event, "editing")).toBeNull();
  });

  it("uses the physical S key when Option changes the typed character", () => {
    expect(
      getInteractionModeShortcutTarget({ ...shortcut, key: "ß" }, "suggesting"),
    ).toBe("editing");
  });

  it.each([
    "INPUT",
    "TEXTAREA",
    "SELECT",
  ])("does not intercept the shortcut in a %s control", (tagName) => {
    expect(
      getInteractionModeShortcutTarget(
        { ...shortcut, target: { tagName } },
        "suggesting",
      ),
    ).toBeNull();
  });
});

describe("copy path shortcut", () => {
  const copyShortcut = { ...shortcut, code: "KeyC", key: "ç" };

  it("matches the physical C key on macOS when Option changes its character", () => {
    expect(matchesCopyPathShortcut(copyShortcut, "MacIntel")).toBe(true);
  });

  it("matches Ctrl+Alt+C outside Apple platforms", () => {
    expect(
      matchesCopyPathShortcut(
        { ...copyShortcut, metaKey: false, ctrlKey: true, key: "c" },
        "Linux x86_64",
      ),
    ).toBe(true);
  });

  it.each([
    { ...copyShortcut, ctrlKey: true },
    { ...copyShortcut, repeat: true },
    { ...copyShortcut, isComposing: true },
    { ...copyShortcut, target: { tagName: "TEXTAREA" } },
  ])("ignores unsafe macOS key events", (event) => {
    expect(matchesCopyPathShortcut(event, "MacIntel")).toBe(false);
  });
});

describe("document find shortcuts", () => {
  const findShortcut = {
    ...shortcut,
    code: "KeyF",
    key: "f",
    altKey: false,
  };

  it("maps the standard Command shortcuts to find actions", () => {
    expect(getDocumentFindShortcutAction(findShortcut)).toBe("open");
    expect(
      getDocumentFindShortcutAction({
        ...findShortcut,
        code: "KeyG",
        key: "g",
      }),
    ).toBe("next");
    expect(
      getDocumentFindShortcutAction({
        ...findShortcut,
        code: "KeyG",
        key: "g",
        shiftKey: true,
      }),
    ).toBe("previous");
  });

  it("maps the equivalent Control shortcuts outside macOS", () => {
    expect(
      getDocumentFindShortcutAction({
        ...findShortcut,
        metaKey: false,
        ctrlKey: true,
      }),
    ).toBe("open");
  });

  it("ignores non-standard modifier combinations", () => {
    for (const event of [
      { ...findShortcut, metaKey: false },
      { ...findShortcut, altKey: true },
      { ...findShortcut, ctrlKey: true },
      { ...findShortcut, shiftKey: true },
      { ...findShortcut, code: "KeyG", key: "g", altKey: true },
    ]) {
      expect(getDocumentFindShortcutAction(event)).toBeNull();
    }
  });
});
