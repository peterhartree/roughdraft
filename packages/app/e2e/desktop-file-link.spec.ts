import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  expect,
  test,
} from "@playwright/test";

function recordExternalOpens(electronApp: ElectronApplication) {
  return electronApp.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { openedExternally?: string[] }).openedExternally = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
}

function externalOpens(electronApp: ElectronApplication) {
  return electronApp.evaluate(
    () =>
      (globalThis as { openedExternally?: string[] }).openedExternally ?? [],
  );
}

test("opens linked non-Markdown files outside the editor window @smoke", async () => {
  test.skip(
    process.platform !== "darwin",
    "Roughdraft Desktop is packaged and handed off on macOS.",
  );

  const apiPort = Number(process.env.API_PORT ?? 4317);
  const origin = `http://127.0.0.1:${apiPort}`;
  const temporaryDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-desktop-file-link-")),
  );
  const stateFile = path.join(temporaryDirectory, "server.json");
  const userDataDirectory = path.join(temporaryDirectory, "electron-profile");
  fs.writeFileSync(stateFile, JSON.stringify({ port: apiPort, url: origin }));

  // The shell runs `roughdraft start` from ~/.local/bin at launch; a stub
  // keeps the test away from any real managed server on this machine.
  const homeDirectory = path.join(temporaryDirectory, "home");
  const stubBin = path.join(homeDirectory, ".local", "bin");
  fs.mkdirSync(stubBin, { recursive: true });
  fs.writeFileSync(path.join(stubBin, "roughdraft"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });

  const documentPath = path.join(temporaryDirectory, "notes.md");
  fs.writeFileSync(documentPath, "# Notes\n\n[clip](clip.mp3)\n");
  fs.writeFileSync(path.join(temporaryDirectory, "clip.mp3"), "stub audio");

  const electronApp = await electron.launch({
    args: [
      path.resolve("packages/desktop"),
      `--user-data-dir=${userDataDirectory}`,
    ],
    env: {
      ...process.env,
      HOME: homeDirectory,
      ROUGHDRAFT_STATE_FILE: stateFile,
    },
  });

  try {
    const window = await electronApp.firstWindow();
    await expect(window).toHaveURL(`${origin}/`);
    await recordExternalOpens(electronApp);

    const response = await fetch(`${origin}/api/open-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: documentPath,
        modifiedAt: fs.statSync(documentPath).mtimeMs,
        activate: true,
      }),
    });
    expect(response.ok).toBe(true);

    const link = window.locator('a[data-markdown-src="clip.mp3"]');
    await expect(link).toBeVisible();
    const documentUrl = window.url();

    await link.click();

    await expect
      .poll(() => externalOpens(electronApp))
      .toEqual([expect.stringMatching(/\/api\/files\?.*clip\.mp3/)]);
    expect(window.url()).toBe(documentUrl);
    await expect(link).toBeVisible();

    // Any other route that tries to load a served file into this window is
    // redirected to the browser as well.
    const servedFileUrl = (await externalOpens(electronApp))[0];
    await window.evaluate((url) => window.location.assign(url), servedFileUrl);

    await expect
      .poll(async () => (await externalOpens(electronApp)).length)
      .toBe(2);
    // Playwright keeps waiting on a navigation Electron cancelled, so ask the
    // renderer directly whether the document is still on screen.
    const rendererState = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
        `({ url: location.href, hasLink: !!document.querySelector('a[data-markdown-src="clip.mp3"]') })`,
      ),
    );
    expect(rendererState).toEqual({ url: documentUrl, hasLink: true });
  } finally {
    await electronApp.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
