import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentWorkspace } from "../src/DocumentWorkspace";
import {
  diskChangeStateBlocksFileSwitch,
  fetchDocumentFromDisk,
  resolveDiskWatchEventAction,
} from "../src/disk-change-state";
import {
  MarkdownFileNotFoundError,
  type Page,
  type StorageBackend,
} from "../src/storage";

function createBackend(
  getMarkdownFile: StorageBackend["getMarkdownFile"],
): StorageBackend {
  return {
    info: {
      kind: "local-files",
      label: "Test backend",
      detail: "In-memory",
      projectPath: "/tmp/project",
    },
    canManageProjects: false,
    getMarkdownFile,
    async saveMarkdownFile() {
      return undefined;
    },
    async saveAsset(file) {
      return {
        markdownPath: file.name,
        previewUrl: `file://${file.name}`,
        mimeType: file.type || "application/octet-stream",
      };
    },
    resolveFileUrl(path) {
      return `file://${path}`;
    },
    async openProject() {},
  };
}

describe("resolveDiskWatchEventAction", () => {
  it("classifies a deleted file as missing, not changed", () => {
    expect(
      resolveDiskWatchEventAction({
        event: { path: "doc.md", exists: false, version: null },
        currentVersion: "v1",
        diskChangeState: "clean",
        isDirty: false,
      }),
    ).toBe("missing");
  });

  it("classifies deletion as missing even while autosave is paused", () => {
    expect(
      resolveDiskWatchEventAction({
        event: { path: "doc.md", exists: false, version: null },
        currentVersion: "v1",
        diskChangeState: "paused",
        isDirty: true,
      }),
    ).toBe("missing");
  });

  it("ignores events matching the current document version", () => {
    expect(
      resolveDiskWatchEventAction({
        event: { path: "doc.md", exists: true, version: "v1" },
        currentVersion: "v1",
        diskChangeState: "clean",
        isDirty: false,
      }),
    ).toBe("ignore");
  });

  it("ignores external changes while autosave is paused", () => {
    expect(
      resolveDiskWatchEventAction({
        event: { path: "doc.md", exists: true, version: "v2" },
        currentVersion: "v1",
        diskChangeState: "paused",
        isDirty: true,
      }),
    ).toBe("ignore");
  });

  it("marks the document changed when dirty and the disk file changed", () => {
    expect(
      resolveDiskWatchEventAction({
        event: { path: "doc.md", exists: true, version: "v2" },
        currentVersion: "v1",
        diskChangeState: "clean",
        isDirty: true,
      }),
    ).toBe("mark-changed");
  });

  it("reloads silently when clean and the disk file changed", () => {
    expect(
      resolveDiskWatchEventAction({
        event: { path: "doc.md", exists: true, version: "v2" },
        currentVersion: "v1",
        diskChangeState: "clean",
        isDirty: false,
      }),
    ).toBe("reload");
  });
});

describe("fetchDocumentFromDisk", () => {
  it("reports a deleted file as missing instead of throwing", async () => {
    const backend = createBackend(async (relativePath) => {
      throw new MarkdownFileNotFoundError(relativePath);
    });

    await expect(fetchDocumentFromDisk(backend, "doc.md")).resolves.toEqual({
      status: "missing",
    });
  });

  it("returns the loaded document when the file exists", async () => {
    const page: Page = { id: "doc.md", title: "Doc", content: "hi" };
    const backend = createBackend(async () => page);

    await expect(fetchDocumentFromDisk(backend, "doc.md")).resolves.toEqual({
      status: "loaded",
      document: page,
    });
  });

  it("captures unexpected failures instead of rejecting", async () => {
    const failure = new Error("network down");
    const backend = createBackend(async () => {
      throw failure;
    });

    await expect(fetchDocumentFromDisk(backend, "doc.md")).resolves.toEqual({
      status: "error",
      error: failure,
    });
  });
});

describe("diskChangeStateBlocksFileSwitch", () => {
  it("allows switching documents when the active file is missing", () => {
    expect(diskChangeStateBlocksFileSwitch("missing")).toBe(false);
  });

  it("allows switching documents when the active file is clean", () => {
    expect(diskChangeStateBlocksFileSwitch("clean")).toBe(false);
  });

  it("still blocks switching for unresolved conflict states", () => {
    expect(diskChangeStateBlocksFileSwitch("changed")).toBe(true);
    expect(diskChangeStateBlocksFileSwitch("conflict")).toBe(true);
    expect(diskChangeStateBlocksFileSwitch("paused")).toBe(true);
  });
});

describe("missing-file conflict notice", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          onchange: null,
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderWorkspace(handlers: {
    onReloadDocumentFromDisk?: () => void;
    onOverwriteDocumentOnDisk?: () => void;
  }) {
    const page: Page = { id: "doc.md", title: "Doc", content: "Hello" };
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <DocumentWorkspace
          documentPage={page}
          activeDocumentPath="doc.md"
          documentCopyPath={null}
          documentFilenameLabel="doc.md"
          documentEditorViewMode="rich-text"
          onDocumentEditorViewModeChange={() => {}}
          onSaveDocument={async () => {}}
          onDocumentSaveStateChange={() => {}}
          onDocumentDirtyStateChange={() => {}}
          onDocumentLocalContentChange={() => {}}
          onSaveControllerChange={() => {}}
          onViewControllerChange={() => {}}
          documentDiskChangeState="missing"
          documentForceResetKey="doc.md"
          documentViewRestoreRequest={null}
          onReloadDocumentFromDisk={
            handlers.onReloadDocumentFromDisk ?? (() => {})
          }
          onKeepEditingWithoutAutosave={() => {}}
          onOverwriteDocumentOnDisk={
            handlers.onOverwriteDocumentOnDisk ?? (() => {})
          }
          backend={createBackend(async () => page)}
          documentSidebarAvailable={false}
          documentSidebarVisible={false}
          onToggleDocumentSidebar={() => {}}
        />,
      );
    });
  }

  it("explains the file was deleted and offers to save the draft back", async () => {
    const onOverwriteDocumentOnDisk = vi.fn();
    await renderWorkspace({ onOverwriteDocumentOnDisk });

    const notice = container.querySelector(
      "[data-testid='file-conflict-notice']",
    );
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("File deleted on disk");

    const overwriteButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='file-conflict-action-overwrite']",
    );
    expect(overwriteButton).not.toBeNull();
    expect(overwriteButton?.textContent).toContain("Save draft to disk");

    await act(async () => {
      overwriteButton?.click();
    });
    expect(onOverwriteDocumentOnDisk).toHaveBeenCalledTimes(1);
  });

  it("hides the keep-editing action for a missing file", async () => {
    await renderWorkspace({});

    expect(
      container.querySelector(
        "[data-testid='file-conflict-action-keep-editing']",
      ),
    ).toBeNull();
  });
});
