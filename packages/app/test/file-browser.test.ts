import { describe, expect, it } from "vitest";
import {
  buildFileBrowserTree,
  type FileBrowserDirectory,
  findFileBrowserNode,
  getPinnedNodesInTree,
  getRevealFolders,
  type MarkdownTreeListing,
} from "../src/file-browser";
import {
  isFolderOpen,
  readFileBrowserPreferences,
  setFolderOpenState,
  writeFileBrowserPreferences,
} from "../src/file-browser-preferences";
import {
  getOpenFileStepShortcut,
  getSteppedOpenFilePath,
} from "../src/open-file-navigation";

const root = "/Users/me/project";

function listing(paths: string[]): MarkdownTreeListing {
  return {
    root,
    name: "project",
    kind: "git",
    files: paths.map((path, index) => ({ path, modifiedAt: index })),
    truncated: false,
  };
}

function describeTree(directory: FileBrowserDirectory, depth = 0): string[] {
  return directory.children.flatMap((child) => [
    `${"  ".repeat(depth)}${child.kind === "directory" ? `${child.name}/` : child.name}`,
    ...(child.kind === "directory" ? describeTree(child, depth + 1) : []),
  ]);
}

describe("file browser tree", () => {
  it("lists folders before files, each in natural name order", () => {
    const tree = buildFileBrowserTree(
      listing([
        "README.md",
        "docs/adr/0010-later.md",
        "docs/adr/0002-early.md",
        ".context/plan.md",
        "AGENTS.md",
        "docs/index.md",
      ]),
    );

    expect(describeTree(tree)).toEqual([
      ".context/",
      "  plan.md",
      "docs/",
      "  adr/",
      "    0002-early.md",
      "    0010-later.md",
      "  index.md",
      "AGENTS.md",
      "README.md",
    ]);
  });

  it("gives every node an absolute path for opening and pinning", () => {
    const tree = buildFileBrowserTree(listing(["docs/adr/0001.md"]));
    const docs = tree.children[0] as FileBrowserDirectory;
    const adr = docs.children[0] as FileBrowserDirectory;

    expect(tree.path).toBe(root);
    expect(docs.path).toBe(`${root}/docs`);
    expect(adr.children[0]).toMatchObject({
      kind: "file",
      path: `${root}/docs/adr/0001.md`,
      modifiedAt: 0,
    });
  });

  it("reveals a file by expanding the root and each folder above it", () => {
    expect(getRevealFolders(root, `${root}/docs/adr/0001.md`)).toEqual([
      root,
      `${root}/docs`,
      `${root}/docs/adr`,
    ]);
    expect(getRevealFolders(root, `${root}/README.md`)).toEqual([root]);
  });

  it("does not reveal files outside the root or in a sibling with a shared prefix", () => {
    expect(getRevealFolders(root, "/Users/me/other/plan.md")).toEqual([]);
    expect(getRevealFolders(root, "/Users/me/project-two/plan.md")).toEqual([]);
  });

  it("finds pinned files and folders inside a tree in pin order", () => {
    const tree = buildFileBrowserTree(
      listing(["README.md", "docs/guide.md", "docs/adr/0001.md"]),
    );

    expect(
      getPinnedNodesInTree(tree, [
        `${root}/docs/adr`,
        "/Users/me/elsewhere/notes.md",
        `${root}/README.md`,
        `${root}/docs/missing.md`,
      ]).map((node) => `${node.kind}:${node.path}`),
    ).toEqual([`directory:${root}/docs/adr`, `file:${root}/README.md`]);
  });

  it("looks up nodes by absolute path", () => {
    const tree = buildFileBrowserTree(listing(["docs/guide.md"]));

    expect(findFileBrowserNode(tree, root)).toBe(tree);
    expect(findFileBrowserNode(tree, `${root}/docs/guide.md`)).toMatchObject({
      kind: "file",
      name: "guide.md",
    });
    expect(findFileBrowserNode(tree, `${root}/docs/guide.md/x`)).toBeNull();
    expect(findFileBrowserNode(tree, "/Users/me/project-two/a.md")).toBeNull();
  });
});

describe("file browser preferences", () => {
  function memoryStorage(initial?: string) {
    const values = new Map<string, string>();
    if (initial !== undefined)
      values.set("roughdraft.file-browser.v1", initial);
    return {
      values,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
  }

  it("round-trips pins, folder states and section layout", () => {
    const storage = memoryStorage();
    writeFileBrowserPreferences(storage, {
      pinnedFolders: ["/Users/me/notes"],
      projectPins: ["/Users/me/notes/plan.md"],
      folderOpenStates: { "/Users/me/notes/drafts": true },
      openSectionHeight: 240,
      openSectionCollapsed: false,
      browseSectionCollapsed: true,
    });

    expect(readFileBrowserPreferences(storage)).toEqual({
      pinnedFolders: ["/Users/me/notes"],
      projectPins: ["/Users/me/notes/plan.md"],
      folderOpenStates: { "/Users/me/notes/drafts": true },
      openSectionHeight: 240,
      openSectionCollapsed: false,
      browseSectionCollapsed: true,
    });
  });

  it("falls back to defaults for corrupt storage and drops invalid entries", () => {
    expect(readFileBrowserPreferences(memoryStorage("{not json"))).toEqual({
      pinnedFolders: [],
      projectPins: [],
      folderOpenStates: {},
      openSectionHeight: null,
      openSectionCollapsed: false,
      browseSectionCollapsed: false,
    });

    const preferences = readFileBrowserPreferences(
      memoryStorage(
        JSON.stringify({
          pinnedFolders: ["/ok", "relative", 3, "/ok"],
          folderOpenStates: { "/ok/a": true, relative: true, "/ok/b": "yes" },
          openSectionHeight: -5,
        }),
      ),
    );
    expect(preferences.pinnedFolders).toEqual(["/ok"]);
    expect(preferences.folderOpenStates).toEqual({ "/ok/a": true });
    expect(preferences.openSectionHeight).toBeNull();
  });

  it("opens roots and closes subfolders until the user chooses otherwise", () => {
    let states: Record<string, boolean> = {};
    expect(isFolderOpen(states, root, true)).toBe(true);
    expect(isFolderOpen(states, `${root}/docs`, false)).toBe(false);

    states = setFolderOpenState(states, root, false);
    states = setFolderOpenState(states, `${root}/docs`, true);
    expect(isFolderOpen(states, root, true)).toBe(false);
    expect(isFolderOpen(states, `${root}/docs`, false)).toBe(true);
  });
});

describe("stepping between open files", () => {
  const files = ["/a.md", "/b.md", "/c.md"].map((path, index) => ({
    path,
    modifiedAt: 0,
    openedAt: 3 - index,
    unread: false,
  }));
  const shortcut = {
    code: "",
    metaKey: true,
    altKey: true,
    ctrlKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
  };

  it("maps Command+Option+Left and Right to previous and next", () => {
    expect(getOpenFileStepShortcut({ ...shortcut, key: "ArrowLeft" })).toBe(-1);
    expect(getOpenFileStepShortcut({ ...shortcut, key: "ArrowRight" })).toBe(1);
  });

  it("leaves Command+Left, Option+Left and shifted variants to text editing", () => {
    expect(
      getOpenFileStepShortcut({ ...shortcut, key: "ArrowLeft", altKey: false }),
    ).toBeNull();
    expect(
      getOpenFileStepShortcut({
        ...shortcut,
        key: "ArrowLeft",
        metaKey: false,
      }),
    ).toBeNull();
    expect(
      getOpenFileStepShortcut({
        ...shortcut,
        key: "ArrowLeft",
        shiftKey: true,
      }),
    ).toBeNull();
  });

  it("steps through list order and stops at either end", () => {
    expect(getSteppedOpenFilePath(files, "/b.md", -1)).toBe("/a.md");
    expect(getSteppedOpenFilePath(files, "/b.md", 1)).toBe("/c.md");
    expect(getSteppedOpenFilePath(files, "/a.md", -1)).toBeNull();
    expect(getSteppedOpenFilePath(files, "/c.md", 1)).toBeNull();
    expect(getSteppedOpenFilePath(files, "/missing.md", 1)).toBeNull();
  });
});
