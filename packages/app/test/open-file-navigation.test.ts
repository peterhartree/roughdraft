import { describe, expect, it } from "vitest";
import {
  filterOpenFiles,
  getOpenFileCloseCandidates,
  getOpenFileShortcut,
  isCloseAllOpenFilesShortcut,
  isCloseOpenFileShortcut,
  isOpenFileSwitcherShortcut,
  markOpenFileRead,
  shouldHandleOpenRequestInSession,
  sortOpenFiles,
  upsertOpenFile,
} from "../src/open-file-navigation";

const first = {
  path: "/tmp/first.md",
  modifiedAt: 100,
  openedAt: 1_000,
  unread: false,
};
const second = {
  path: "/tmp/second.md",
  modifiedAt: 200,
  openedAt: 2_000,
  unread: true,
};

describe("open-file ordering and read state", () => {
  it("sorts most recently opened first with a stable path tie-break", () => {
    expect(
      sortOpenFiles([first, second, { ...first, path: "/tmp/alpha.md" }]).map(
        (file) => file.path,
      ),
    ).toEqual(["/tmp/second.md", "/tmp/alpha.md", "/tmp/first.md"]);
  });

  it("ignores modification times when open times differ", () => {
    expect(
      sortOpenFiles([
        { ...first, modifiedAt: 900 },
        { ...second, modifiedAt: 50 },
      ]).map((file) => file.path),
    ).toEqual(["/tmp/second.md", "/tmp/first.md"]);
  });

  it("stamps newly opened files with the current time and sorts them first", () => {
    expect(
      upsertOpenFile(
        [first],
        {
          path: "/tmp/second.md",
          modifiedAt: 250,
          unread: true,
        },
        3_000,
      ),
    ).toEqual([
      {
        path: "/tmp/second.md",
        modifiedAt: 250,
        openedAt: 3_000,
        unread: true,
      },
      first,
    ]);
  });

  it("keeps a file in place when only its modification time refreshes", () => {
    expect(
      upsertOpenFile(
        [second, first],
        {
          path: first.path,
          modifiedAt: 900,
          unread: false,
        },
        3_000,
      ),
    ).toEqual([second, { ...first, modifiedAt: 900 }]);
  });

  it("moves a reopened file to the top when given a new open time", () => {
    expect(
      upsertOpenFile([second, first], {
        path: first.path,
        modifiedAt: first.modifiedAt,
        openedAt: 3_000,
        unread: false,
      }),
    ).toEqual([{ ...first, openedAt: 3_000 }, second]);
  });

  it("marks a selected file as read without changing other files", () => {
    expect(markOpenFileRead([second, first], second.path)).toEqual([
      { ...second, unread: false },
      first,
    ]);
  });

  it("selects the next adjacent file after closing the active one", () => {
    const third = { ...first, path: "/tmp/third.md" };

    expect(
      getOpenFileCloseCandidates([second, first, third], first.path),
    ).toEqual([third.path, second.path]);
    expect(
      getOpenFileCloseCandidates([second, first, third], third.path),
    ).toEqual([first.path, second.path]);
    expect(getOpenFileCloseCandidates([first], first.path)).toEqual([]);
    expect(getOpenFileCloseCandidates([first], "/tmp/missing.md")).toEqual([]);
  });

  it("preserves the list reference when an update changes nothing", () => {
    const files = [first];
    expect(upsertOpenFile(files, first)).toBe(files);
    expect(markOpenFileRead(files, first.path)).toBe(files);
  });
});

describe("open-file shortcuts", () => {
  const shortcut = {
    key: "1",
    code: "Digit1",
    metaKey: true,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
  };

  it("selects visible files with Command plus a number", () => {
    expect(getOpenFileShortcut(shortcut, 3)).toEqual({
      type: "select-index",
      index: 0,
    });
    expect(getOpenFileShortcut({ ...shortcut, code: "Digit3" }, 3)).toEqual({
      type: "select-index",
      index: 2,
    });
    expect(getOpenFileShortcut({ ...shortcut, code: "Digit4" }, 3)).toBeNull();
  });

  it("leaves Command plus arrows available to the editor", () => {
    expect(
      getOpenFileShortcut({ ...shortcut, code: "ArrowLeft" }, 3),
    ).toBeNull();
    expect(
      getOpenFileShortcut({ ...shortcut, code: "ArrowRight" }, 3),
    ).toBeNull();
  });

  it("recognises only the exact Command-P quick-switcher shortcut", () => {
    expect(isOpenFileSwitcherShortcut({ ...shortcut, code: "KeyP" })).toBe(
      true,
    );
    expect(
      isOpenFileSwitcherShortcut({ ...shortcut, code: "KeyP", shiftKey: true }),
    ).toBe(false);
  });

  it("recognises only the exact Command-W close shortcut", () => {
    expect(
      isCloseOpenFileShortcut({ ...shortcut, key: "w", code: "KeyW" }),
    ).toBe(true);
    expect(
      isCloseOpenFileShortcut({ ...shortcut, key: "w", code: "KeyZ" }),
    ).toBe(true);
    expect(
      isCloseOpenFileShortcut({
        ...shortcut,
        key: "w",
        code: "KeyW",
        altKey: true,
      }),
    ).toBe(false);
    expect(
      isCloseOpenFileShortcut({ ...shortcut, key: "z", code: "KeyW" }),
    ).toBe(false);
  });

  it("recognises only the exact Command-Shift-W close-all shortcut", () => {
    const closeAllShortcut = {
      ...shortcut,
      key: "w",
      code: "KeyW",
      shiftKey: true,
    };

    expect(isCloseAllOpenFilesShortcut(closeAllShortcut)).toBe(true);
    expect(
      isCloseAllOpenFilesShortcut({ ...closeAllShortcut, code: "KeyZ" }),
    ).toBe(true);
    expect(
      isCloseAllOpenFilesShortcut({ ...closeAllShortcut, shiftKey: false }),
    ).toBe(false);
    expect(
      isCloseAllOpenFilesShortcut({ ...closeAllShortcut, repeat: true }),
    ).toBe(false);
  });

  it.each([
    { ...shortcut, metaKey: false },
    { ...shortcut, altKey: true },
    { ...shortcut, ctrlKey: true },
    { ...shortcut, shiftKey: true },
    { ...shortcut, repeat: true },
    { ...shortcut, isComposing: true },
  ])("ignores unsafe modifier combinations", (event) => {
    expect(getOpenFileShortcut(event, 3)).toBeNull();
  });
});

describe("open-file filename matching", () => {
  it("matches case-insensitive filename substrings without searching paths", () => {
    const files = [
      second,
      first,
      {
        path: "/tmp/first-notes/draft.md",
        modifiedAt: 50,
        openedAt: 500,
        unread: false,
      },
    ];

    expect(filterOpenFiles(files, "SECOND")).toEqual([second]);
    expect(filterOpenFiles(files, "first")).toEqual([first]);
    expect(filterOpenFiles(files, "  ")).toEqual(files);
  });
});

describe("incoming open requests", () => {
  it("handles local startup and active local-file requests in-session, but not remote ones", () => {
    expect(shouldHandleOpenRequestInSession(undefined, "/tmp/draft.md")).toBe(
      true,
    );
    expect(
      shouldHandleOpenRequestInSession("local-files", "/tmp/draft.md"),
    ).toBe(true);
    expect(shouldHandleOpenRequestInSession("remote", null)).toBe(false);
    expect(
      shouldHandleOpenRequestInSession("local-storage", "/tmp/draft.md"),
    ).toBe(false);
  });
});
