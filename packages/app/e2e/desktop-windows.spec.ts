import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import {
  appendInCodeEditor,
  codeEditor,
  documentSaveStatus,
  fileConflictNotice,
  richTextEditor,
} from "./helpers";

interface DesktopFixture {
  stateFile: string;
  userDataDirectory: string;
}

function requireElectronApp(
  electronApp: ElectronApplication | null,
): ElectronApplication {
  if (!electronApp) throw new Error("Desktop application is not running");
  return electronApp;
}

function activeFilePath(window: Page): Promise<string | null> {
  return window
    .locator('[data-testid="open-file-sidebar-item"][aria-current="page"]')
    .getAttribute("data-file-path");
}

function openFileCount(window: Page): Promise<number> {
  return window.getByTestId("open-file-sidebar-item").count();
}

function storedActiveFilePath(window: Page): Promise<string | null> {
  return window.evaluate(() => {
    const sessionKey = window.roughdraftDesktop?.session.key;
    if (!sessionKey) return null;
    const value = window.localStorage.getItem(
      `roughdraft.open-file-session.v1.${sessionKey}`,
    );
    if (!value) return null;
    const session = JSON.parse(value) as { activePath?: unknown };
    return typeof session.activePath === "string" ? session.activePath : null;
  });
}

async function itemByPath(
  window: Page,
  testId: string,
  attribute: string,
  filePath: string,
): Promise<Locator> {
  const items = window.getByTestId(testId);
  const paths = await items.evaluateAll(
    (elements, attributeName) =>
      elements.map((element) => element.getAttribute(attributeName)),
    attribute,
  );
  const index = paths.indexOf(filePath);
  expect(index).toBeGreaterThanOrEqual(0);
  return items.nth(index);
}

async function openNewWindow(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ Menu }) => {
    const fileMenu = Menu.getApplicationMenu()?.items.find(
      (item) => item.label === "File",
    );
    const newWindow = fileMenu?.submenu?.items.find(
      (item) => item.label === "New Window",
    );
    if (!newWindow) throw new Error("File > New Window is missing");
    newWindow.click();
  });
}

async function postOpenRequest(
  origin: string,
  filePath: string,
): Promise<void> {
  const response = await fetch(`${origin}/api/open-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: filePath,
      modifiedAt: fs.statSync(filePath).mtimeMs,
      activate: true,
    }),
  });
  expect(response.ok).toBe(true);
}

async function addSharedRecentDocument(
  sourceWindow: Page,
  filePath: string,
): Promise<void> {
  await sourceWindow.evaluate(
    ({ path: nextPath, modifiedAt }) => {
      const key = "roughdraft.recent-documents.v1";
      const current = JSON.parse(window.localStorage.getItem(key) ?? "[]") as {
        path: string;
        modifiedAt: number;
        lastViewedAt: number;
      }[];
      window.localStorage.setItem(
        key,
        JSON.stringify([
          { path: nextPath, modifiedAt, lastViewedAt: Date.now() },
          ...current.filter((document) => document.path !== nextPath),
        ]),
      );
    },
    { path: filePath, modifiedAt: fs.statSync(filePath).mtimeMs },
  );
}

async function launchDesktop(
  fixture: DesktopFixture,
): Promise<ElectronApplication> {
  return electron.launch({
    args: [
      path.resolve("packages/desktop"),
      `--user-data-dir=${fixture.userDataDirectory}`,
    ],
    env: {
      ...process.env,
      ROUGHDRAFT_STATE_FILE: fixture.stateFile,
    },
  });
}

async function quitDesktop(electronApp: ElectronApplication): Promise<void> {
  const closed = electronApp.waitForEvent("close");
  await electronApp.evaluate(({ app }) => {
    setTimeout(() => app.quit(), 0);
  });
  await closed;
}

async function cleanUpDesktop(
  electronApp: ElectronApplication | null,
): Promise<void> {
  if (!electronApp) return;
  const closed = electronApp.waitForEvent("close").then(() => true);
  try {
    await electronApp.evaluate(({ app }) => {
      setTimeout(() => app.quit(), 0);
    });
    const closedGracefully = await Promise.race([
      closed,
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    if (closedGracefully) return;

    await electronApp.evaluate(({ app, BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
      app.exit(0);
    });
    await Promise.race([
      closed,
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
  } catch {
    // The process may have exited between the graceful and forced attempts.
  }
}

async function restoredWindows(
  electronApp: ElectronApplication,
  origin: string,
  count: number,
): Promise<Page[]> {
  await expect.poll(() => electronApp.windows().length).toBe(count);
  const windows = electronApp.windows();
  await Promise.all(
    windows.map((window) =>
      expect
        .poll(() => {
          try {
            return new URL(window.url()).origin;
          } catch {
            return null;
          }
        })
        .toBe(origin),
    ),
  );
  return windows;
}

async function windowWithActivePath(
  windows: Page[],
  filePath: string,
): Promise<Page> {
  await expect
    .poll(async () => {
      const paths = await Promise.all(windows.map(activeFilePath));
      return paths.includes(filePath);
    })
    .toBe(true);
  const paths = await Promise.all(windows.map(activeFilePath));
  const index = paths.indexOf(filePath);
  if (index < 0) throw new Error(`No window restored ${filePath}`);
  return windows[index];
}

test("isolates, routes and restores native document windows @smoke", async () => {
  test.skip(
    process.platform !== "darwin",
    "Roughdraft Desktop is packaged and handed off on macOS.",
  );
  test.setTimeout(120_000);

  const apiPort = Number(process.env.API_PORT ?? 4617);
  const origin = `http://localhost:${apiPort}`;
  const temporaryDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-desktop-windows-")),
  );
  const fixture: DesktopFixture = {
    stateFile: path.join(temporaryDirectory, "server.json"),
    userDataDirectory: path.join(temporaryDirectory, "electron-profile"),
  };
  const status = (await fetch(`${origin}/api/status`).then((response) =>
    response.json(),
  )) as { pid: number };
  fs.writeFileSync(
    fixture.stateFile,
    JSON.stringify({
      port: apiPort,
      pid: status.pid,
      startedAt: new Date().toISOString(),
      url: origin,
    }),
  );

  const firstFile = path.join(temporaryDirectory, "first.md");
  const secondFile = path.join(temporaryDirectory, "second.md");
  const thirdFile = path.join(temporaryDirectory, "third.md");
  const fourthFile = path.join(temporaryDirectory, "fourth.md");
  fs.writeFileSync(firstFile, "# First window\n\nFirst body.\n");
  fs.writeFileSync(secondFile, "# Second window\n\nSecond body.\n");
  fs.writeFileSync(thirdFile, "# Third document\n\nThird body.\n");
  fs.writeFileSync(fourthFile, "# Fourth document\n\nFourth body.\n");

  // A broken native session must fall back to one clean window.
  fs.mkdirSync(fixture.userDataDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(fixture.userDataDirectory, "window-session.json"),
    "{broken",
  );

  let electronApp: ElectronApplication | null = null;
  try {
    electronApp = await launchDesktop(fixture);
    const firstWindow = await electronApp.firstWindow();
    await expect(firstWindow).toHaveURL(`${origin}/`);
    await expect(firstWindow.getByTestId("recent-documents")).toBeVisible();

    await postOpenRequest(origin, firstFile);
    await expect.poll(() => activeFilePath(firstWindow)).toBe(firstFile);

    await openNewWindow(electronApp);
    await expect.poll(() => electronApp?.windows().length).toBe(2);
    const secondWindow = electronApp
      .windows()
      .find((candidate) => candidate !== firstWindow);
    if (!secondWindow) throw new Error("New native window did not open");
    await expect(secondWindow).toHaveURL(`${origin}/`);

    // A renderer-level Recent open of an already owned path raises its owner
    // and leaves the new window empty.
    const recentFirst = await itemByPath(
      secondWindow,
      "recent-document-item",
      "data-file-path",
      firstFile,
    );
    await recentFirst.click();
    await expect.poll(() => openFileCount(secondWindow)).toBe(0);
    await expect.poll(() => activeFilePath(firstWindow)).toBe(firstFile);

    // Seed an unowned shared recent entry in the first window, then open it
    // from the second. The real storage event keeps the second renderer in
    // sync; its claim makes this a source-specific renderer open.
    await addSharedRecentDocument(firstWindow, secondFile);
    const recentSecond = await itemByPath(
      secondWindow,
      "recent-document-item",
      "data-file-path",
      secondFile,
    );
    await recentSecond.click();
    await expect.poll(() => activeFilePath(secondWindow)).toBe(secondFile);
    await expect.poll(() => activeFilePath(firstWindow)).toBe(firstFile);

    // Browse uses the same duplicate-owner claim boundary as Recent.
    const browsedFirst = await itemByPath(
      secondWindow,
      "file-browser-file",
      "data-browser-path",
      firstFile,
    );
    await browsedFirst.click();
    await expect.poll(() => activeFilePath(secondWindow)).toBe(secondFile);
    await expect.poll(() => openFileCount(secondWindow)).toBe(1);

    // The duplicate Browse delivery focuses the first owner in main. The
    // following unowned server request therefore routes to that window.
    await postOpenRequest(origin, thirdFile);
    await expect.poll(() => activeFilePath(firstWindow)).toBe(thirdFile);
    await expect.poll(() => openFileCount(firstWindow)).toBe(2);

    // Delivering the second window's owned path makes it most recent; the
    // next unowned request must follow it.
    await postOpenRequest(origin, secondFile);
    await expect.poll(() => activeFilePath(secondWindow)).toBe(secondFile);
    await postOpenRequest(origin, fourthFile);
    await expect.poll(() => activeFilePath(secondWindow)).toBe(fourthFile);
    await expect.poll(() => openFileCount(secondWindow)).toBe(2);

    // An existing owner beats recent focus and receives its stored spelling.
    // This selection change is the reliable native-owner assertion on the
    // Playwright runner, where BrowserWindow native focus state is absent.
    await postOpenRequest(origin, firstFile);
    await expect.poll(() => activeFilePath(firstWindow)).toBe(firstFile);
    await expect.poll(() => openFileCount(firstWindow)).toBe(2);
    await expect.poll(() => activeFilePath(secondWindow)).toBe(fourthFile);
    await expect.poll(() => openFileCount(secondWindow)).toBe(2);
    await expect.poll(() => storedActiveFilePath(firstWindow)).toBe(firstFile);

    await postOpenRequest(origin, secondFile);
    await expect.poll(() => activeFilePath(secondWindow)).toBe(secondFile);

    for (const window of [firstWindow, secondWindow]) {
      await window.getByTestId("document-editor-view-toggle").click();
      await expect(codeEditor(window)).toBeVisible();
    }
    await appendInCodeEditor(firstWindow, "\nSaved only by first window.\n");
    await firstWindow.keyboard.press("Meta+s");
    await expect
      .poll(() => fs.readFileSync(firstFile, "utf8"))
      .toContain("Saved only by first window.");
    await expect(documentSaveStatus(firstWindow)).toHaveAttribute(
      "aria-label",
      "Saved",
    );
    expect(fs.readFileSync(secondFile, "utf8")).not.toContain(
      "Saved only by first window.",
    );

    await appendInCodeEditor(secondWindow, "\nSaved only by second window.\n");
    await secondWindow.keyboard.press("Meta+s");
    await expect
      .poll(() => fs.readFileSync(secondFile, "utf8"))
      .toContain("Saved only by second window.");
    await expect(documentSaveStatus(secondWindow)).toHaveAttribute(
      "aria-label",
      "Saved",
    );
    expect(fs.readFileSync(firstFile, "utf8")).not.toContain(
      "Saved only by second window.",
    );

    const screenshotDirectory = path.resolve(
      ".context/ui-state-screenshots/multiple-windows",
    );
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    await firstWindow.screenshot({
      path: path.join(screenshotDirectory, "first-window.png"),
    });
    await secondWindow.screenshot({
      path: path.join(screenshotDirectory, "second-window.png"),
    });

    // A real disk conflict blocks the all-window quit before any window
    // closes. Only the explanatory native dialog is stubbed.
    await codeEditor(firstWindow).click();
    await firstWindow.keyboard.press("Meta+End");
    fs.writeFileSync(firstFile, "# External first-window change\n");
    await firstWindow.keyboard.type("\nUnsaved conflicting draft.\n");
    await expect(fileConflictNotice(firstWindow)).toBeVisible();
    await electronApp.evaluate(({ dialog }) => {
      Object.assign(globalThis, { __roughdraftBlockedDialogs: 0 });
      dialog.showMessageBox = (async () => {
        const state = globalThis as typeof globalThis & {
          __roughdraftBlockedDialogs: number;
        };
        state.__roughdraftBlockedDialogs += 1;
        return { response: 0, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    });
    const blockedFirstUrl = firstWindow.url();
    const blockedSecondUrl = secondWindow.url();
    await electronApp.evaluate(({ app }) => {
      setTimeout(() => app.quit(), 0);
    });
    await expect
      .poll(() =>
        requireElectronApp(electronApp).evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __roughdraftBlockedDialogs?: number;
              }
            ).__roughdraftBlockedDialogs ?? 0,
        ),
      )
      .toBe(1);
    expect(electronApp.windows()).toHaveLength(2);
    expect(firstWindow.url()).toBe(blockedFirstUrl);
    expect(secondWindow.url()).toBe(blockedSecondUrl);

    await firstWindow.getByTestId("file-conflict-action-overwrite").click();
    await expect(fileConflictNotice(firstWindow)).toBeHidden();
    await expect(documentSaveStatus(firstWindow)).toHaveAttribute(
      "aria-label",
      "Saved",
    );

    await quitDesktop(electronApp);
    electronApp = null;

    electronApp = await launchDesktop(fixture);
    let windows = await restoredWindows(electronApp, origin, 2);
    const restoredFirst = await windowWithActivePath(windows, firstFile);
    const restoredSecond = await windowWithActivePath(windows, secondFile);
    await expect.poll(() => openFileCount(restoredFirst)).toBe(2);
    await expect.poll(() => openFileCount(restoredSecond)).toBe(2);
    await expect(richTextEditor(restoredFirst)).toContainText(
      "Unsaved conflicting draft.",
    );
    await expect(richTextEditor(restoredSecond)).toContainText(
      "Saved only by second window.",
    );

    const restoredSecondNative =
      await electronApp.browserWindow(restoredSecond);
    await restoredSecondNative.evaluate((window) => window.close());
    await expect.poll(() => electronApp?.windows().length).toBe(1);
    await expect.poll(() => activeFilePath(restoredFirst)).toBe(firstFile);

    await quitDesktop(electronApp);
    electronApp = null;

    electronApp = await launchDesktop(fixture);
    windows = await restoredWindows(electronApp, origin, 1);
    await expect.poll(() => activeFilePath(windows[0])).toBe(firstFile);
    await expect.poll(() => openFileCount(windows[0])).toBe(2);
    await expect.poll(() => storedActiveFilePath(windows[0])).toBe(firstFile);

    // Main reloads one crashed renderer in place. Run this after the full
    // lifecycle because Playwright marks its old Page target as crashed even
    // after Electron has recovered the renderer.
    const survivorTitle = await windows[0].title();
    const crashedWindow = await electronApp.evaluate(
      ({ BrowserWindow }, title) => {
        const target = BrowserWindow.getAllWindows().find(
          (window) => window.getTitle() === title,
        );
        if (!target) throw new Error(`Could not find native window ${title}`);
        const previousProcessId = target.webContents.getOSProcessId();
        target.webContents.forcefullyCrashRenderer();
        return { id: target.id, previousProcessId };
      },
      survivorTitle,
    );
    await expect
      .poll(
        () =>
          requireElectronApp(electronApp).evaluate(
            ({ BrowserWindow }, crashed) => {
              const target = BrowserWindow.fromId(crashed.id);
              if (!target || target.isDestroyed()) return false;
              const processId = target.webContents.getOSProcessId();
              return (
                processId > 0 &&
                processId !== crashed.previousProcessId &&
                !target.webContents.isLoadingMainFrame()
              );
            },
            crashedWindow,
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          requireElectronApp(electronApp).evaluate(
            async ({ BrowserWindow }, windowId) => {
              const target = BrowserWindow.fromId(windowId);
              if (!target || target.isDestroyed()) return null;
              return target.webContents.executeJavaScript(`(() => {
                const sessionKey = window.roughdraftDesktop?.session.key ?? null;
                const rawSession = sessionKey
                  ? window.localStorage.getItem(
                      \`roughdraft.open-file-session.v1.\${sessionKey}\`,
                    )
                  : null;
                return {
                  href: window.location.href,
                  sessionKey,
                  rawSession,
                  activePath:
                    document
                      .querySelector(
                        '[data-testid="open-file-sidebar-item"][aria-current="page"]',
                      )
                      ?.getAttribute('data-file-path') ?? null,
                  sidebarPaths: Array.from(
                    document.querySelectorAll(
                      '[data-testid="open-file-sidebar-item"]',
                    ),
                    (item) => item.getAttribute('data-file-path'),
                  ),
                  bodyText: document.body.innerText.slice(0, 300),
                };
              })()`);
            },
            crashedWindow.id,
          ),
        { timeout: 15_000 },
      )
      .toMatchObject({
        activePath: firstFile,
        sessionKey: expect.any(String),
        sidebarPaths: expect.arrayContaining([firstFile]),
      });
  } finally {
    await cleanUpDesktop(electronApp);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
