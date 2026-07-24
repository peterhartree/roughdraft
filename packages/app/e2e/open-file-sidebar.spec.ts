import fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  appendInCodeEditor,
  captureResponsiveScreenshots,
  codeEditor,
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  removeMarkdownProject,
  richTextEditor,
  selectRichText,
  writeProjectFile,
} from "./helpers";

function postOpenRequest(page: Page, filePath: string) {
  let modifiedAt: number | null;
  try {
    modifiedAt = fs.statSync(filePath).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    modifiedAt = null;
  }

  return page.request.post("/api/open-request", {
    data: {
      path: filePath,
      modifiedAt,
    },
  });
}

async function openFileItem(page: Page, filePath: string) {
  const items = page.getByTestId("open-file-sidebar-item");
  const paths = await items.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.filePath),
  );
  const index = paths.indexOf(filePath);
  expect(index).toBeGreaterThanOrEqual(0);
  return items.nth(index);
}

async function recentDocumentItem(page: Page, filePath: string) {
  const items = page.getByTestId("recent-document-item");
  const paths = await items.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.filePath),
  );
  const index = paths.indexOf(filePath);
  expect(index).toBeGreaterThanOrEqual(0);
  return items.nth(index);
}

test.describe("open-file sidebar", () => {
  let firstProjectDir: string;
  let secondProjectDir: string;

  test.beforeEach(() => {
    firstProjectDir = createMarkdownProject("sidebar-first");
    secondProjectDir = createMarkdownProject("sidebar-second");
  });

  test.afterEach(() => {
    removeMarkdownProject(firstProjectDir);
    removeMarkdownProject(secondProjectDir);
  });

  test("shows the recent-documents workspace when no files have been opened @smoke", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByTestId("recent-documents")).toBeVisible();
    await expect(page.getByTestId("recent-documents-empty")).toContainText(
      "No recent documents yet",
    );
    await expect(page.getByTestId("homepage-workflow-storyboard")).toHaveCount(
      0,
    );
    await captureResponsiveScreenshots(page, {
      desktop: "recent-documents-empty-desktop.png",
      mobile: "recent-documents-empty-mobile.png",
    });
  });

  test("queues an incoming file unread when a conflict blocks activation @smoke", async ({
    page,
  }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "first.md",
      "# First file\n\nInitial document.\n",
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "second.md",
      "# Second file\n\nIncoming document.\n",
    );
    fs.utimesSync(firstPath, new Date(100_000), new Date(100_000));
    fs.utimesSync(secondPath, new Date(200_000), new Date(200_000));

    await openMarkdownFile(page, firstPath, "code");
    await expect(page.getByTestId("open-file-sidebar")).toBeVisible();
    await expect(codeEditor(page)).toContainText("Initial document.");

    await appendInCodeEditor(page, "\nUnsaved local edit.");
    fs.writeFileSync(firstPath, "# First file\n\nChanged on disk.\n");
    await expect(page.getByTestId("file-conflict-notice")).toBeVisible();

    const response = await postOpenRequest(page, secondPath);
    expect(response.ok()).toBe(true);

    const items = page.getByTestId("open-file-sidebar-item");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("second.md");
    await expect(items.nth(0)).toHaveAttribute("data-unread", "true");
    await expect(items.nth(1)).toContainText("first.md");
    await expect(codeEditor(page)).toContainText("Unsaved local edit.");

    await captureResponsiveScreenshots(page, {
      desktop: "open-file-sidebar-desktop-unread.png",
      mobile: "open-file-sidebar-mobile-unread.png",
    });

    logE2eEvent("open-file-sidebar.conflict-queued-unread", {
      orderedPaths: [secondPath, firstPath],
      incomingStartedUnread: true,
      activationBlockedBy: "file-conflict",
    });
  });

  test("makes an incoming open request the active document", async ({
    page,
  }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "active.md",
      "# Active\n\nAlready open.\n",
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "incoming.md",
      "# Incoming\n\nTake over the main pane.\n",
    );

    await openMarkdownFile(page, firstPath, "code");
    await expect(codeEditor(page)).toContainText("Already open.");

    const response = await postOpenRequest(page, secondPath);
    expect(response.ok()).toBe(true);
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(2);

    await expect(codeEditor(page)).toContainText("Take over the main pane.");
    const incomingItem = await openFileItem(page, secondPath);
    await expect(incomingItem).toHaveAttribute("aria-current", "page");
    await expect(incomingItem).toHaveAttribute("data-unread", "false");
    await expect(page).toHaveURL(
      (url) => url.searchParams.get("path") === secondPath,
    );
  });

  test("activates the last of two rapid open requests", async ({ page }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "start.md",
      "# Start\n\nAlready open.\n",
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "queued.md",
      "# Queued\n\nRequested first.\n",
    );
    const thirdPath = writeProjectFile(
      secondProjectDir,
      "latest.md",
      "# Latest\n\nRequested last, ends up active.\n",
    );

    await openMarkdownFile(page, firstPath, "code");
    await expect(codeEditor(page)).toContainText("Already open.");

    await postOpenRequest(page, secondPath);
    await postOpenRequest(page, thirdPath);

    await expect(codeEditor(page)).toContainText(
      "Requested last, ends up active.",
    );
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(3);
    await expect(await openFileItem(page, thirdPath)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("flushes pending edits before switching files", async ({ page }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "editing.md",
      "# Editing\n\nKeep this change.\n",
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "target.md",
      "# Target\n\nSwitch destination.\n",
    );

    await openMarkdownFile(page, firstPath, "code");
    await expect(codeEditor(page)).toContainText("Keep this change.");
    await postOpenRequest(page, secondPath);
    await expect(codeEditor(page)).toContainText("Switch destination.");
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(2);
    await (await openFileItem(page, firstPath)).click();
    await expect(codeEditor(page)).toContainText("Keep this change.");

    await appendInCodeEditor(page, "\nSaved before switching.");
    await (await openFileItem(page, secondPath)).click();

    await expect(codeEditor(page)).toContainText("Switch destination.");
    await expect
      .poll(() => fs.readFileSync(firstPath, "utf8"))
      .toContain("Saved before switching.");

    logE2eEvent("open-file-sidebar.pending-save-flushed", {
      from: firstPath,
      to: secondPath,
    });
  });

  test("closes the active file with Command-W and removes it from the restored session", async ({
    page,
  }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "remaining.md",
      "# Remaining\n\nReturn here after closing.\n",
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "closing.md",
      "# Closing\n\nSave this before closing.\n",
    );
    fs.utimesSync(firstPath, new Date(100_000), new Date(100_000));
    fs.utimesSync(secondPath, new Date(200_000), new Date(200_000));

    await openMarkdownFile(page, firstPath, "code");
    await postOpenRequest(page, secondPath);
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(2);
    await expect(codeEditor(page)).toContainText("Save this before closing.");
    await appendInCodeEditor(page, "\nSaved by Command-W.");

    await page.keyboard.press("Meta+KeyW");

    await expect(codeEditor(page)).toContainText("Return here after closing.");
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(1);
    await expect(await openFileItem(page, firstPath)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect
      .poll(() => fs.readFileSync(secondPath, "utf8"))
      .toContain("Saved by Command-W.");
    await expect
      .poll(() =>
        page.evaluate((closedPath) => {
          const stored = window.localStorage.getItem(
            "roughdraft.open-file-session.v1",
          );
          if (!stored) return null;
          const session = JSON.parse(stored);
          return {
            activePath: session.activePath,
            paths: session.files.map((file: { path: string }) => file.path),
            closedViewStatePresent: Boolean(session.viewStates?.[closedPath]),
          };
        }, secondPath),
      )
      .toEqual({
        activePath: firstPath,
        paths: [firstPath],
        closedViewStatePresent: false,
      });

    await appendInCodeEditor(page, "\nSaved on final close.");
    await page.keyboard.press("Meta+KeyW");

    await expect(page).toHaveURL(/\/$/);
    const recentItems = page.getByTestId("recent-document-item");
    await expect(page.getByTestId("recent-documents")).toBeVisible();
    await expect(recentItems).toHaveCount(2);
    await expect(recentItems.nth(0)).toHaveAttribute(
      "data-file-path",
      firstPath,
    );
    await expect(recentItems.nth(1)).toHaveAttribute(
      "data-file-path",
      secondPath,
    );
    await expect(page.getByTestId("homepage-workflow-storyboard")).toHaveCount(
      0,
    );
    await captureResponsiveScreenshots(page, {
      desktop: "recent-documents-desktop.png",
      mobile: "recent-documents-mobile.png",
    });
    await expect(
      page.evaluate(() =>
        window.localStorage.getItem("roughdraft.open-file-session.v1"),
      ),
    ).resolves.toBeNull();
    await expect
      .poll(() => fs.readFileSync(firstPath, "utf8"))
      .toContain("Saved on final close.");

    await recentItems.nth(1).click();
    await expect(richTextEditor(page)).toContainText(
      "Save this before closing.",
    );
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(1);

    logE2eEvent("open-file-sidebar.command-w-close-verified", {
      closedPath: secondPath,
      remainingPath: firstPath,
      lastCloseReturnedHome: true,
      recentDocumentCount: 2,
      reopenedRecentPath: secondPath,
    });
  });

  test("keeps the active file open when a disk conflict blocks Command-W", async ({
    page,
  }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "remaining.md",
      "# Remaining\n\nStay in the sidebar.\n",
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "conflicted.md",
      "# Conflicted\n\nKeep this open.\n",
    );

    await openMarkdownFile(page, firstPath, "code");
    await postOpenRequest(page, secondPath);
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(2);
    await expect(codeEditor(page)).toContainText("Keep this open.");
    await appendInCodeEditor(page, "\nUnsaved local edit.");
    fs.writeFileSync(secondPath, "# Conflicted\n\nChanged on disk.\n");
    await expect(page.getByTestId("file-conflict-notice")).toBeVisible();

    await page.keyboard.press("Meta+KeyW");

    await expect(codeEditor(page)).toContainText("Unsaved local edit.");
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(2);
    await expect(await openFileItem(page, secondPath)).toHaveAttribute(
      "aria-current",
      "page",
    );

    logE2eEvent("open-file-sidebar.command-w-conflict-blocked", {
      activePath: secondPath,
      openFileCount: 2,
    });
  });

  test("skips a missing adjacent file when Command-W closes the active file", async ({
    page,
  }) => {
    const fallbackPath = writeProjectFile(
      firstProjectDir,
      "fallback.md",
      "# Fallback\n\nOpen this after pruning the missing file.\n",
    );
    const missingPath = writeProjectFile(
      secondProjectDir,
      "missing.md",
      "# Missing\n\nThis disappears before close.\n",
    );
    const closingPath = writeProjectFile(
      secondProjectDir,
      "closing.md",
      "# Closing\n\nClose despite the stale neighbour.\n",
    );
    fs.utimesSync(fallbackPath, new Date(100_000), new Date(100_000));
    fs.utimesSync(missingPath, new Date(200_000), new Date(200_000));
    fs.utimesSync(closingPath, new Date(300_000), new Date(300_000));

    await openMarkdownFile(page, fallbackPath, "code");
    await postOpenRequest(page, missingPath);
    await expect(codeEditor(page)).toContainText(
      "This disappears before close.",
    );
    await postOpenRequest(page, closingPath);
    await expect(codeEditor(page)).toContainText(
      "Close despite the stale neighbour.",
    );
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(3);
    fs.renameSync(missingPath, `${missingPath}.unavailable`);

    await page.keyboard.press("Meta+KeyW");

    await expect(codeEditor(page)).toContainText(
      "Open this after pruning the missing file.",
    );
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(1);
    await expect(await openFileItem(page, fallbackPath)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("keeps every file open when the Command-W fallback has a transient server error", async ({
    page,
  }) => {
    const fallbackPath = writeProjectFile(
      firstProjectDir,
      "temporary-error.md",
      "# Temporary error\n\nKeep this sidebar entry.\n",
    );
    const closingPath = writeProjectFile(
      secondProjectDir,
      "closing.md",
      "# Closing\n\nKeep this open when fallback fails.\n",
    );

    await openMarkdownFile(page, fallbackPath, "code");
    await postOpenRequest(page, closingPath);
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(2);
    await expect(codeEditor(page)).toContainText(
      "Keep this open when fallback fails.",
    );

    await page.route("**/api/markdown-file?**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        request.method() === "GET" &&
        url.searchParams.get("projectPath") === firstProjectDir &&
        url.searchParams.get("path") === "temporary-error.md"
      ) {
        await route.fulfill({ status: 500, body: "Temporary server error" });
        return;
      }
      await route.continue();
    });

    await page.keyboard.press("Meta+KeyW");

    await expect(codeEditor(page)).toContainText(
      "Keep this open when fallback fails.",
    );
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(2);
    await expect(await openFileItem(page, closingPath)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const stored = window.localStorage.getItem(
            "roughdraft.open-file-session.v1",
          );
          if (!stored) return null;
          const session = JSON.parse(stored);
          return {
            activePath: session.activePath,
            paths: session.files.map((file: { path: string }) => file.path),
          };
        }),
      )
      .toEqual({
        activePath: closingPath,
        paths: expect.arrayContaining([fallbackPath, closingPath]),
      });
  });

  test("keeps a recent document after a transient open failure and retries it", async ({
    page,
  }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "surviving-recent.md",
      "# Surviving recent\n\nKeep this entry too.\n",
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "retry-recent.md",
      "# Retry recent\n\nOpen this after recovery.\n",
    );

    await openMarkdownFile(page, firstPath, "rich-text");
    await postOpenRequest(page, secondPath);
    await expect(richTextEditor(page)).toContainText(
      "Open this after recovery.",
    );
    await page.keyboard.press("Meta+KeyW");
    await expect(richTextEditor(page)).toContainText("Keep this entry too.");
    await page.keyboard.press("Meta+KeyW");
    await expect(page.getByTestId("recent-document-item")).toHaveCount(2);

    await page.route("**/api/markdown-file?**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        request.method() === "GET" &&
        url.searchParams.get("projectPath") === secondProjectDir &&
        url.searchParams.get("path") === "retry-recent.md"
      ) {
        await route.fulfill({ status: 500, body: "Temporary server error" });
        return;
      }
      await route.continue();
    });

    await (await recentDocumentItem(page, secondPath)).click();
    await expect(page.getByTestId("recent-documents-error")).toBeVisible();
    await expect(page.getByTestId("recent-document-item")).toHaveCount(2);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const stored = window.localStorage.getItem(
            "roughdraft.recent-documents.v1",
          );
          return stored
            ? JSON.parse(stored).map((entry: { path: string }) => entry.path)
            : [];
        }),
      )
      .toEqual(expect.arrayContaining([firstPath, secondPath]));

    await page.unroute("**/api/markdown-file?**");
    await (await recentDocumentItem(page, secondPath)).click();
    await expect(richTextEditor(page)).toContainText(
      "Open this after recovery.",
    );
  });

  test("removes a recent document only after it is confirmed missing", async ({
    page,
  }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "remaining-recent.md",
      "# Remaining recent\n\nKeep this entry.\n",
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "missing-recent.md",
      "# Missing recent\n\nRemove this entry.\n",
    );

    await openMarkdownFile(page, firstPath, "rich-text");
    await postOpenRequest(page, secondPath);
    await expect(richTextEditor(page)).toContainText("Remove this entry.");
    await page.keyboard.press("Meta+KeyW");
    await expect(richTextEditor(page)).toContainText("Keep this entry.");
    await page.keyboard.press("Meta+KeyW");
    await expect(page.getByTestId("recent-document-item")).toHaveCount(2);
    fs.renameSync(secondPath, `${secondPath}.unavailable`);

    await (await recentDocumentItem(page, secondPath)).click();

    await expect(page.getByTestId("recent-documents-error")).toBeVisible();
    await expect(page.getByTestId("recent-document-item")).toHaveCount(1);
    await expect(await recentDocumentItem(page, firstPath)).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const stored = window.localStorage.getItem(
            "roughdraft.recent-documents.v1",
          );
          return stored
            ? JSON.parse(stored).map((entry: { path: string }) => entry.path)
            : [];
        }),
      )
      .toEqual([firstPath]);
  });

  test("ignores a second switch while the first switch is flushing", async ({
    page,
  }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "editing.md",
      "# Editing\n\nKeep the first switch.\n",
    );
    const firstTargetPath = writeProjectFile(
      secondProjectDir,
      "first-target.md",
      "# First target\n\nExpected destination.\n",
    );
    const secondTargetPath = writeProjectFile(
      secondProjectDir,
      "second-target.md",
      "# Second target\n\nMust not reopen during the flush.\n",
    );

    await openMarkdownFile(page, firstPath, "code");
    await postOpenRequest(page, firstTargetPath);
    await expect(codeEditor(page)).toContainText("Expected destination.");
    await postOpenRequest(page, secondTargetPath);
    await expect(codeEditor(page)).toContainText(
      "Must not reopen during the flush.",
    );
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(3);
    await (await openFileItem(page, firstPath)).click();
    await expect(codeEditor(page)).toContainText("Keep the first switch.");
    await appendInCodeEditor(page, "\nFlush once.");

    let secondTargetReads = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.pathname === "/api/markdown-file" &&
        url.searchParams.get("projectPath") === secondProjectDir &&
        url.searchParams.get("path") === "second-target.md"
      ) {
        secondTargetReads += 1;
      }
    });

    await page.evaluate(
      ({ firstTargetPath, secondTargetPath }) => {
        const items = Array.from(
          document.querySelectorAll<HTMLElement>("[data-file-path]"),
        );
        items
          .find((item) => item.dataset.filePath === firstTargetPath)
          ?.click();
        items
          .find((item) => item.dataset.filePath === secondTargetPath)
          ?.click();
      },
      { firstTargetPath, secondTargetPath },
    );

    await expect(codeEditor(page)).toContainText("Expected destination.");
    expect(secondTargetReads).toBe(0);
  });

  test("also flushes edits made while a switch save is in flight", async ({
    page,
  }) => {
    const firstContent = [
      "# Editing",
      "",
      ...Array.from(
        { length: 120 },
        (_, index) => `Paragraph ${index + 1}: initial content.`,
      ),
    ].join("\n");
    const firstPath = writeProjectFile(
      firstProjectDir,
      "editing.md",
      firstContent,
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "target.md",
      "# Target\n\nOpened after both saves.\n",
    );

    await openMarkdownFile(page, firstPath, "code");
    await postOpenRequest(page, secondPath);
    await expect(codeEditor(page)).toContainText("Opened after both saves.");
    await (await openFileItem(page, firstPath)).click();
    await expect(codeEditor(page)).toContainText(
      "Paragraph 1: initial content.",
    );

    let releaseFirstSave!: () => void;
    const firstSaveReleased = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    let markFirstSaveStarted!: () => void;
    const firstSaveStarted = new Promise<void>((resolve) => {
      markFirstSaveStarted = resolve;
    });
    let saveCount = 0;
    await page.route("**/api/markdown-file?*", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      saveCount += 1;
      if (saveCount === 1) {
        markFirstSaveStarted();
        await firstSaveReleased;
      }
      await route.continue();
    });

    await appendInCodeEditor(page, "\nFirst edit.");
    await (await openFileItem(page, secondPath)).click();
    await firstSaveStarted;
    await appendInCodeEditor(page, "\nSecond edit during save.");
    const workspace = page.getByTestId("document-workspace-scroll");
    const expectedScrollTop = await workspace.evaluate((element) => {
      element.scrollTop = Math.min(
        375,
        element.scrollHeight - element.clientHeight,
      );
      return element.scrollTop;
    });
    expect(expectedScrollTop).toBeGreaterThan(100);
    releaseFirstSave();

    await expect(codeEditor(page)).toContainText("Opened after both saves.");
    await expect
      .poll(() => fs.readFileSync(firstPath, "utf8"))
      .toContain("Second edit during save.");
    expect(saveCount).toBeGreaterThanOrEqual(2);

    await page.keyboard.press("Meta+KeyP");
    await page.getByTestId("open-file-switcher-input").fill("editing");
    await page.keyboard.press("Enter");
    await expect(codeEditor(page)).toContainText("Second edit during save.");
    await expect(codeEditor(page)).toBeFocused();
    await expect
      .poll(() => workspace.evaluate((element) => element.scrollTop))
      .toBe(expectedScrollTop);

    const cursorMarker = " [captured after save]";
    await page.keyboard.type(cursorMarker);
    await page.keyboard.press("Meta+KeyS");
    await expect
      .poll(() => fs.readFileSync(firstPath, "utf8"))
      .toContain(`Second edit during save.${cursorMarker}`);
  });

  test("moves the file watcher when equal filenames live in different folders", async ({
    page,
  }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "draft.md",
      "# First draft\n\nOriginal first file.\n",
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "draft.md",
      "# Second draft\n\nOriginal second file.\n",
    );

    await openMarkdownFile(page, firstPath, "code");
    await postOpenRequest(page, secondPath);
    await expect(codeEditor(page)).toContainText("Original second file.");

    fs.writeFileSync(firstPath, "# First draft\n\nIgnored old-file change.\n");
    await page.waitForTimeout(500);
    await expect(codeEditor(page)).not.toContainText(
      "Ignored old-file change.",
    );

    fs.writeFileSync(secondPath, "# Second draft\n\nReloaded active file.\n");
    await expect(codeEditor(page)).toContainText("Reloaded active file.");
  });

  test("keeps the current draft open when its save fails", async ({ page }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "editing.md",
      "# Editing\n\nUnsaved source.\n",
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "target.md",
      "# Target\n\nOut of reach while saving fails.\n",
    );

    await openMarkdownFile(page, firstPath, "code");
    await postOpenRequest(page, secondPath);
    await expect(codeEditor(page)).toContainText(
      "Out of reach while saving fails.",
    );
    await (await openFileItem(page, firstPath)).click();
    await expect(codeEditor(page)).toContainText("Unsaved source.");
    await page.route("**/api/markdown-file?*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (
        route.request().method() === "PUT" &&
        requestUrl.searchParams.get("projectPath") === firstProjectDir
      ) {
        await route.fulfill({ status: 500, body: "save failed" });
        return;
      }
      await route.continue();
    });

    await appendInCodeEditor(page, "\nKeep this in the editor.");
    await (await openFileItem(page, secondPath)).click();

    await expect(codeEditor(page)).toContainText("Keep this in the editor.");
    await expect(codeEditor(page)).not.toContainText(
      "Out of reach while saving fails.",
    );
    await expect(page.getByTestId("open-file-switch-error")).toContainText(
      "current file could not be saved",
    );
  });

  test("shows a recoverable error when an incoming file disappears", async ({
    page,
  }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "editing.md",
      "# Editing\n\nOriginal stays open.\n",
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "target.md",
      "# Target\n\nAvailable after retry.\n",
    );

    await openMarkdownFile(page, firstPath, "code");
    await postOpenRequest(page, secondPath);
    await expect(codeEditor(page)).toContainText("Available after retry.");
    await (await openFileItem(page, firstPath)).click();
    await expect(codeEditor(page)).toContainText("Original stays open.");
    const unavailablePath = `${secondPath}.unavailable`;
    fs.renameSync(secondPath, unavailablePath);
    await (await openFileItem(page, secondPath)).click();

    await expect(codeEditor(page)).toContainText("Original stays open.");
    await expect(page.getByTestId("open-file-switch-error")).toContainText(
      "Could not open target.md",
    );

    await appendInCodeEditor(page, "\nSaved after failed switch.");
    await expect
      .poll(() => fs.readFileSync(firstPath, "utf8"))
      .toContain("Saved after failed switch.");

    fs.renameSync(unavailablePath, secondPath);
    await (await openFileItem(page, secondPath)).click();
    await expect(codeEditor(page)).toContainText("Available after retry.");
    await expect(page.getByTestId("open-file-switch-error")).toHaveCount(0);
  });

  test("waits for an asset insertion before switching projects", async ({
    page,
  }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "editing.md",
      "# Editing\n\nUpload here.\n",
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "target.md",
      "# Target\n\nOpen after upload.\n",
    );

    await openMarkdownFile(page, firstPath, "rich-text");
    await postOpenRequest(page, secondPath);
    await expect(richTextEditor(page)).toContainText("Open after upload.");
    await (await openFileItem(page, firstPath)).click();
    await expect(richTextEditor(page)).toContainText("Upload here.");

    let releaseAssetRequest!: () => void;
    const assetRequestReleased = new Promise<void>((resolve) => {
      releaseAssetRequest = resolve;
    });
    let markAssetRequestStarted!: () => void;
    const assetRequestStarted = new Promise<void>((resolve) => {
      markAssetRequestStarted = resolve;
    });
    let uploadedProjectPath: unknown;
    await page.route("**/api/assets?*", async (route) => {
      uploadedProjectPath = route.request().postDataJSON().projectPath;
      markAssetRequestStarted();
      await assetRequestReleased;
      await route.continue();
    });

    await richTextEditor(page).evaluate((editor) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["attachment contents"], "notes.txt", {
          type: "text/plain",
        }),
      );
      editor.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      );
    });
    await assetRequestStarted;

    await (await openFileItem(page, secondPath)).click();
    await expect(richTextEditor(page)).toContainText("Upload here.");
    expect(uploadedProjectPath).toBe(firstProjectDir);

    releaseAssetRequest();
    await expect(richTextEditor(page)).toContainText("Open after upload.");
    await expect
      .poll(() => fs.readFileSync(firstPath, "utf8"))
      .toContain("[notes.txt](./.roughdraft-assets/");
    expect(fs.existsSync(`${firstProjectDir}/.roughdraft-assets`)).toBe(true);
    expect(fs.existsSync(`${secondProjectDir}/.roughdraft-assets`)).toBe(false);
  });

  test("restores the active file and sidebar when the app reopens at its root", async ({
    page,
  }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "first.md",
      "# First\n\nPreviously open.\n",
    );
    const targetPhrase = "resume here after reopening";
    const secondContent = [
      "# Second",
      "",
      ...Array.from({ length: 140 }, (_, index) =>
        index === 99
          ? `Paragraph ${index + 1}: ${targetPhrase}.`
          : `Paragraph ${index + 1}: most recently viewed.`,
      ),
    ].join("\n\n");
    const secondPath = writeProjectFile(
      secondProjectDir,
      "second.md",
      secondContent,
    );

    await openMarkdownFile(page, firstPath, "rich-text");
    await postOpenRequest(page, secondPath);
    await expect(richTextEditor(page)).toContainText(targetPhrase);
    await selectRichText(page, targetPhrase);
    const workspace = page.getByTestId("document-workspace-scroll");
    const expectedScrollTop = await workspace.evaluate((element) => {
      element.scrollTop = Math.min(
        525,
        element.scrollHeight - element.clientHeight,
      );
      return element.scrollTop;
    });
    expect(expectedScrollTop).toBeGreaterThan(100);

    await page.goto("/");

    await expect(richTextEditor(page)).toContainText(targetPhrase);
    await expect(richTextEditor(page)).toBeFocused();
    await expect
      .poll(() => workspace.evaluate((element) => element.scrollTop))
      .toBe(expectedScrollTop);
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(2);
    await expect(await openFileItem(page, secondPath)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(await openFileItem(page, firstPath)).toBeVisible();

    const selectionMarker = "[restart selection restored]";
    await page.keyboard.type(selectionMarker);
    await page.keyboard.press("Meta+KeyS");
    await expect
      .poll(() => fs.readFileSync(secondPath, "utf8"))
      .toContain(`Paragraph 100: ${selectionMarker}.`);
    const expectedExplicitScrollTop = await workspace.evaluate(
      (element) => element.scrollTop,
    );

    await page.goto(
      `/?${new URLSearchParams({ path: secondPath, editor: "rich-text" })}`,
    );
    await expect(richTextEditor(page)).toContainText(selectionMarker);
    await expect(richTextEditor(page)).toBeFocused();
    await expect
      .poll(() => workspace.evaluate((element) => element.scrollTop))
      .toBe(expectedExplicitScrollTop);
    const explicitPathMarker = " [explicit path restored]";
    await page.keyboard.type(explicitPathMarker);
    await page.keyboard.press("Meta+KeyS");
    await expect
      .poll(() => fs.readFileSync(secondPath, "utf8"))
      .toContain(`${selectionMarker}${explicitPathMarker}`);

    logE2eEvent("open-file-sidebar.session-restored", {
      activePath: secondPath,
      openPaths: [firstPath, secondPath],
      scrollTop: expectedScrollTop,
      explicitPathScrollTop: expectedExplicitScrollTop,
      selectionMarkerSavedAtRememberedPosition: true,
      explicitPathMarkerSavedAtRememberedPosition: true,
    });
  });

  test("falls back to another stored file when the active file is unavailable", async ({
    page,
  }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "available.md",
      "# Available\n\nRestore this instead.\n",
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "missing.md",
      "# Missing\n\nMost recently viewed.\n",
    );

    await openMarkdownFile(page, firstPath, "rich-text");
    await postOpenRequest(page, secondPath);
    await expect(richTextEditor(page)).toContainText("Most recently viewed.");
    fs.renameSync(secondPath, `${secondPath}.unavailable`);

    await page.goto("/");

    await expect(richTextEditor(page)).toContainText("Restore this instead.");
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(1);
    await expect(await openFileItem(page, firstPath)).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.keyboard.press("Meta+KeyW");
    await expect(page.getByTestId("recent-documents")).toBeVisible();
    await expect(
      page.locator(
        `[data-testid="recent-document-item"][data-file-path="${secondPath}"]`,
      ),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const stored = window.localStorage.getItem(
            "roughdraft.recent-documents.v1",
          );
          return stored
            ? JSON.parse(stored).map((entry: { path: string }) => entry.path)
            : [];
        }),
      )
      .not.toContain(secondPath);
  });

  test("opens a Command-P switcher and filters by filename", async ({
    page,
  }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "overview.md",
      "# Overview\n\nStarting file.\n",
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "launch-plan.md",
      "# Launch plan\n\nMatching destination.\n",
    );
    const thirdPath = writeProjectFile(
      secondProjectDir,
      "notes.md",
      "# Notes\n\nAnother open file.\n",
    );

    await openMarkdownFile(page, firstPath, "code");
    await postOpenRequest(page, secondPath);
    await expect(codeEditor(page)).toContainText("Matching destination.");
    await postOpenRequest(page, thirdPath);
    await expect(codeEditor(page)).toContainText("Another open file.");
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(3);

    await page.keyboard.press("Meta+KeyP");
    await expect(page.getByTestId("open-file-switcher")).toBeVisible();
    const input = page.getByTestId("open-file-switcher-input");
    await expect(input).toBeFocused();
    await input.fill("LAUNCH");
    await expect(page.getByTestId("open-file-switcher-option")).toHaveCount(1);

    const screenshotDir = process.env.ROUGHDRAFT_SCREENSHOT_DIR;
    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({
        path: `${screenshotDir}/open-file-quick-switcher-filtered.png`,
      });
    }

    await page.keyboard.press("Enter");

    await expect(codeEditor(page)).toContainText("Matching destination.");
    await expect(page.getByTestId("open-file-switcher")).toHaveCount(0);

    logE2eEvent("open-file-sidebar.quick-switcher-verified", {
      query: "LAUNCH",
      selectedPath: secondPath,
    });
  });

  test("restores each file's focus, cursor and scroll position after shortcut navigation", async ({
    page,
  }) => {
    const firstContent = [
      "# Working draft",
      "",
      ...Array.from(
        { length: 180 },
        (_, index) => `Paragraph ${index + 1}: keep scanning this draft.`,
      ),
    ].join("\n");
    const firstPath = writeProjectFile(
      firstProjectDir,
      "working-draft.md",
      firstContent,
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "brief.md",
      "# Brief\n\nShort destination.\n",
    );
    fs.utimesSync(firstPath, new Date(100_000), new Date(100_000));
    fs.utimesSync(secondPath, new Date(200_000), new Date(200_000));

    await openMarkdownFile(page, firstPath, "code");
    await postOpenRequest(page, secondPath);
    await expect(codeEditor(page)).toContainText("Short destination.");
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(2);
    await (await openFileItem(page, firstPath)).click();
    await expect(codeEditor(page)).toContainText("keep scanning this draft");

    const editor = codeEditor(page);
    await editor.click();
    await page.keyboard.press("Control+End");
    const workspace = page.getByTestId("document-workspace-scroll");
    const expectedState = {
      focused: await editor.evaluate(
        (content) =>
          document.activeElement === content ||
          content.contains(document.activeElement),
      ),
      scrollTop: await workspace.evaluate((element) => {
        element.scrollTop = Math.min(
          600,
          element.scrollHeight - element.clientHeight,
        );
        return element.scrollTop;
      }),
    };
    expect(expectedState.focused).toBe(true);
    expect(expectedState.scrollTop).toBeGreaterThan(100);

    await page.keyboard.press("Meta+Digit1");
    await expect(codeEditor(page)).toContainText("Short destination.");
    logE2eEvent("open-file-sidebar.view-state-captured", {
      session: await page.evaluate(() =>
        window.localStorage.getItem("roughdraft.open-file-session.v1"),
      ),
    });

    await page.keyboard.press("Meta+KeyP");
    const switcherInput = page.getByTestId("open-file-switcher-input");
    await switcherInput.fill("working-draft");
    await page.keyboard.press("Enter");
    await expect(codeEditor(page)).toContainText("keep scanning this draft");

    await expect
      .poll(async () => ({
        focused: await codeEditor(page).evaluate(
          (content) =>
            document.activeElement === content ||
            content.contains(document.activeElement),
        ),
        scrollTop: await workspace.evaluate((element) => element.scrollTop),
      }))
      .toEqual(expectedState);

    const cursorMarker = " [restored cursor]";
    await page.keyboard.type(cursorMarker);
    await page.keyboard.press("Meta+KeyS");
    await expect
      .poll(() => fs.readFileSync(firstPath, "utf8"))
      .toBe(`${firstContent}${cursorMarker}`);

    logE2eEvent("open-file-sidebar.view-state-restored", {
      ...expectedState,
      cursorMarkerSavedAtRememberedPosition: true,
    });
  });

  test("restores rich-text focus, selection and scroll after numbered navigation", async ({
    page,
  }) => {
    const targetPhrase = "remember this exact place";
    const firstContent = [
      "# Rich working draft",
      "",
      ...Array.from({ length: 160 }, (_, index) =>
        index === 119
          ? `Paragraph ${index + 1}: ${targetPhrase}.`
          : `Paragraph ${index + 1}: keep reading this rich-text draft.`,
      ),
    ].join("\n\n");
    const firstPath = writeProjectFile(
      firstProjectDir,
      "rich-working-draft.md",
      firstContent,
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "rich-brief.md",
      "# Rich brief\n\nShort destination.\n",
    );
    fs.utimesSync(firstPath, new Date(100_000), new Date(100_000));
    fs.utimesSync(secondPath, new Date(200_000), new Date(200_000));

    await openMarkdownFile(page, firstPath, "rich-text");
    await postOpenRequest(page, secondPath);
    await expect(richTextEditor(page)).toContainText("Short destination.");
    await (await openFileItem(page, firstPath)).click();
    await expect(richTextEditor(page)).toContainText(targetPhrase);
    await selectRichText(page, targetPhrase);

    const workspace = page.getByTestId("document-workspace-scroll");
    const expectedScrollTop = await workspace.evaluate((element) => {
      element.scrollTop = Math.min(
        550,
        element.scrollHeight - element.clientHeight,
      );
      return element.scrollTop;
    });
    expect(expectedScrollTop).toBeGreaterThan(100);

    await page.keyboard.press("Meta+Digit1");
    await expect(richTextEditor(page)).toContainText("Short destination.");

    await page.keyboard.press("Meta+KeyP");
    await page.getByTestId("open-file-switcher-input").fill("rich-working");
    await page.keyboard.press("Enter");
    await expect(richTextEditor(page)).toContainText(targetPhrase);
    await expect(richTextEditor(page)).toBeFocused();
    await expect
      .poll(() => workspace.evaluate((element) => element.scrollTop))
      .toBe(expectedScrollTop);

    const selectionMarker = "[rich selection restored]";
    await page.keyboard.type(selectionMarker);
    await page.keyboard.press("Meta+KeyS");
    await expect
      .poll(() => fs.readFileSync(firstPath, "utf8"))
      .toContain(`Paragraph 120: ${selectionMarker}.`);

    logE2eEvent("open-file-sidebar.rich-view-state-restored", {
      scrollTop: expectedScrollTop,
      selectionMarkerSavedAtRememberedPosition: true,
    });
  });

  test("keeps the quick switcher open when a conflict blocks selection", async ({
    page,
  }) => {
    const firstPath = writeProjectFile(
      firstProjectDir,
      "editing.md",
      "# Editing\n\nKeep this draft.\n",
    );
    const secondPath = writeProjectFile(
      secondProjectDir,
      "destination.md",
      "# Destination\n\nMust remain closed.\n",
    );

    await openMarkdownFile(page, firstPath, "code");
    await appendInCodeEditor(page, "\nUnsaved local edit.");
    fs.writeFileSync(firstPath, "# Editing\n\nChanged on disk.\n");
    await expect(page.getByTestId("file-conflict-notice")).toBeVisible();
    await postOpenRequest(page, secondPath);
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(2);

    await page.keyboard.press("Meta+KeyP");
    const input = page.getByTestId("open-file-switcher-input");
    await input.fill("destination");
    await expect(page.getByTestId("open-file-switcher-option")).toBeDisabled();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("open-file-switcher")).toBeVisible();
    await expect(codeEditor(page)).toContainText("Unsaved local edit.");
    await expect(codeEditor(page)).not.toContainText("Must remain closed.");
  });
});
