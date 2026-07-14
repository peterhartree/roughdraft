import { describe, expect, it } from "vitest";
import { getInteractionModeShortcutTarget } from "../src/workspace-shortcuts";

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
