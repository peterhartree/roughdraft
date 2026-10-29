import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";

function openFilePaths(window: Page): Promise<(string | null)[]> {
  return window
    .getByTestId("open-file-sidebar-item")
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-file-path")).sort(),
    );
}

function activeFilePath(window: Page): Promise<string | null> {
  return window
    .locator('[data-testid="open-file-sidebar-item"][aria-current="page"]')
    .getAttribute("data-file-path");
}

async function openFileMenu(window: Page, filePath: string): Promise<void> {
  await window
    .locator(
      `[data-testid="open-file-sidebar-item"][data-file-path="${filePath}"]`,
    )
    .click({ button: "right" });
}

function launchDesktop(
  userDataDirectory: string,
  stateFile: string,
): Promise<ElectronApplication> {
  return electron.launch({
    args: [
      path.resolve("packages/desktop"),
      `--user-data-dir=${userDataDirectory}`,
    ],
    env: { ...process.env, ROUGHDRAFT_STATE_FILE: stateFile },
  });
}

async function quitDesktop(electronApp: ElectronApplication): Promise<void> {
  const closed = electronApp.waitForEvent("close");
  await electronApp.evaluate(({ app }) => {
    setTimeout(() => app.quit(), 0);
  });
  await closed;
}

async function windowShowing(
  electronApp: ElectronApplication,
  filePath: string,
): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const window of electronApp.windows()) {
        const paths = await openFilePaths(window).catch(() => []);
        if (paths.includes(filePath)) {
          found = window;
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  if (!found) throw new Error(`No window shows ${filePath}`);
  return found;
}

test("moves open files into a new window or another window, and restores both @smoke", async () => {
  test.skip(
    process.platform !== "darwin",
    "Roughdraft Desktop is packaged and handed off on macOS.",
  );
  test.setTimeout(90_000);

  const apiPort = Number(process.env.API_PORT ?? 4317);
  const origin = `http://localhost:${apiPort}`;
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-desktop-move-")),
  );
  const stateFile = path.join(directory, "server.json");
  const userDataDirectory = path.join(directory, "electron-profile");
  const status = (await fetch(`${origin}/api/status`).then((response) =>
    response.json(),
  )) as { pid: number };
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      port: apiPort,
      pid: status.pid,
      startedAt: new Date().toISOString(),
      url: origin,
    }),
  );
  const [plan, notes, draft] = ["plan", "notes", "draft"].map((name) => {
    const filePath = path.join(directory, `${name}.md`);
    fs.writeFileSync(filePath, `# ${name}\n\nBody of ${name}.\n`);
    return filePath;
  });
  const openRequest = async (filePath: string) => {
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
  };

  let electronApp: ElectronApplication | null = await launchDesktop(
    userDataDirectory,
    stateFile,
  );
  try {
    const first = await electronApp.firstWindow();
    await expect(first.getByTestId("recent-documents")).toBeVisible();
    for (const filePath of [plan, notes, draft]) {
      await openRequest(filePath);
      await expect.poll(() => activeFilePath(first)).toBe(filePath);
    }

    // With one window there is nowhere to move to but a new one.
    await openFileMenu(first, notes);
    await expect(
      first.getByTestId("open-file-sidebar-move-to-window"),
    ).toHaveCount(0);
    await first.getByTestId("open-file-sidebar-move-to-new-window").click();

    await expect.poll(() => electronApp?.windows().length).toBe(2);
    const second = await windowShowing(electronApp, notes);
    expect(second).not.toBe(first);
    await expect.poll(() => openFilePaths(second)).toEqual([notes]);
    await expect.poll(() => activeFilePath(second)).toBe(notes);
    await expect.poll(() => openFilePaths(first)).toEqual([draft, plan]);

    // A second window is offered by its active file's name.
    await openFileMenu(first, draft);
    await first.getByTestId("open-file-sidebar-move-to-window").click();
    const target = first.getByTestId("open-file-sidebar-move-to-window-item");
    await expect(target).toHaveText(["notes.md"]);
    await target.click();
    await expect.poll(() => openFilePaths(second)).toEqual([draft, notes]);
    await expect.poll(() => activeFilePath(second)).toBe(draft);
    await expect.poll(() => openFilePaths(first)).toEqual([plan]);

    // Each window keeps its own list across a relaunch.
    await quitDesktop(electronApp);
    electronApp = await launchDesktop(userDataDirectory, stateFile);
    await expect.poll(() => electronApp?.windows().length).toBe(2);
    const restoredFirst = await windowShowing(electronApp, plan);
    const restoredSecond = await windowShowing(electronApp, notes);
    await expect.poll(() => openFilePaths(restoredFirst)).toEqual([plan]);
    await expect
      .poll(() => openFilePaths(restoredSecond))
      .toEqual([draft, notes]);
  } finally {
    if (electronApp) {
      await electronApp
        .evaluate(({ app, BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) window.destroy();
          app.exit(0);
        })
        .catch(() => undefined);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
