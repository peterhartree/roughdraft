import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenFileSidebar } from "../src/OpenFileSidebar";
import type { OpenFileItem } from "../src/open-file-navigation";

describe("open-file sidebar actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("copies a file's absolute path from its right-click menu", async () => {
    const onCopyPath = vi.fn().mockResolvedValue(undefined);
    const filePath = "/Users/me/project/plan.md";

    await act(async () => {
      root.render(
        <OpenFileSidebar
          files={[{ path: filePath, unread: false, modifiedAt: 1 }]}
          activePath={filePath}
          disabled={false}
          error={null}
          onSelect={() => {}}
          onCopyPath={onCopyPath}
        />,
      );
      await Promise.resolve();
    });

    const file = container.querySelector<HTMLElement>(
      '[data-testid="open-file-sidebar-item"]',
    );
    expect(file).not.toBeNull();

    await act(async () => {
      file?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 40,
          clientY: 40,
        }),
      );
      await Promise.resolve();
    });

    const copyPath = document.body.querySelector<HTMLElement>(
      '[data-testid="open-file-sidebar-copy-path"]',
    );
    expect(copyPath).not.toBeNull();

    await act(async () => {
      copyPath?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onCopyPath).toHaveBeenCalledWith(filePath);
  });

  it("does not offer a file action when the list background is right-clicked", async () => {
    await act(async () => {
      root.render(
        <OpenFileSidebar
          files={[
            {
              path: "/Users/me/project/plan.md",
              unread: false,
              modifiedAt: 1,
            },
          ]}
          activePath="/Users/me/project/plan.md"
          disabled={false}
          error={null}
          onSelect={() => {}}
          onCopyPath={() => {}}
        />,
      );
      await Promise.resolve();
    });

    const list = container.querySelector<HTMLOListElement>("ol");
    await act(async () => {
      list?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 40,
          clientY: 80,
        }),
      );
      await Promise.resolve();
    });

    expect(
      document.body.querySelector(
        '[data-testid="open-file-sidebar-copy-path"]',
      ),
    ).toBeNull();
  });

  it("does not copy a stale target removed while its menu is open", async () => {
    const onCopyPath = vi.fn();
    const filePath = "/Users/me/project/removed.md";
    const renderSidebar = async (files: OpenFileItem[]) => {
      await act(async () => {
        root.render(
          <OpenFileSidebar
            files={files}
            activePath={files[0]?.path ?? null}
            disabled={false}
            error={null}
            onSelect={() => {}}
            onCopyPath={onCopyPath}
          />,
        );
        await Promise.resolve();
      });
    };

    await renderSidebar([{ path: filePath, unread: false, modifiedAt: 1 }]);
    const file = container.querySelector<HTMLElement>(
      '[data-testid="open-file-sidebar-item"]',
    );
    await act(async () => {
      file?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 40,
          clientY: 40,
        }),
      );
      await Promise.resolve();
    });

    await renderSidebar([]);
    const staleCopyPath = document.body.querySelector<HTMLElement>(
      '[data-testid="open-file-sidebar-copy-path"]',
    );
    await act(async () => {
      staleCopyPath?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onCopyPath).not.toHaveBeenCalled();
  });

  it("keeps copy path available when file switching is disabled", async () => {
    const onSelect = vi.fn();
    const onCopyPath = vi.fn();
    const blockedPath = "/Users/me/project/blocked.md";

    await act(async () => {
      root.render(
        <OpenFileSidebar
          files={[
            {
              path: "/Users/me/project/active.md",
              unread: false,
              modifiedAt: 2,
            },
            { path: blockedPath, unread: false, modifiedAt: 1 },
          ]}
          activePath="/Users/me/project/active.md"
          disabled={true}
          error={null}
          onSelect={onSelect}
          onCopyPath={onCopyPath}
        />,
      );
      await Promise.resolve();
    });

    const blockedFile = container.querySelectorAll<HTMLElement>(
      '[data-testid="open-file-sidebar-item"]',
    )[1];
    expect(blockedFile.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      blockedFile.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onSelect).not.toHaveBeenCalled();

    await act(async () => {
      blockedFile.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 40,
          clientY: 80,
        }),
      );
      await Promise.resolve();
    });
    const copyPath = document.body.querySelector<HTMLElement>(
      '[data-testid="open-file-sidebar-copy-path"]',
    );
    await act(async () => {
      copyPath?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onCopyPath).toHaveBeenCalledWith(blockedPath);
  });
});
