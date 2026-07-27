import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("writes to the system clipboard through the Electron permission boundary @smoke", async () => {
  test.skip(
    process.platform !== "darwin",
    "Roughdraft Desktop is packaged and handed off on macOS.",
  );

  const apiPort = Number(process.env.API_PORT ?? 4317);
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "roughdraft-desktop-clipboard-"),
  );
  const stateFile = path.join(temporaryDirectory, "server.json");
  const userDataDirectory = path.join(temporaryDirectory, "electron-profile");
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ port: apiPort, url: `http://127.0.0.1:${apiPort}` }),
  );

  const electronApp = await electron.launch({
    args: [
      path.resolve("packages/desktop"),
      `--user-data-dir=${userDataDirectory}`,
    ],
    env: {
      ...process.env,
      ROUGHDRAFT_STATE_FILE: stateFile,
    },
  });

  try {
    const window = await electronApp.firstWindow();
    await expect(window).toHaveURL(`http://127.0.0.1:${apiPort}/`);

    const expectedPath = "/Users/me/project/electron-clipboard.md";
    await window.evaluate(
      (text) => navigator.clipboard.writeText(text),
      expectedPath,
    );

    await expect
      .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(expectedPath);

    await electronApp.evaluate(async ({ BrowserWindow }, origin) => {
      const unrelatedWindow = new BrowserWindow({ show: false });
      await unrelatedWindow.loadURL(origin);
    }, `http://127.0.0.1:${apiPort}/`);
    const unrelatedWindow = electronApp
      .windows()
      .find((candidate) => candidate !== window);
    if (!unrelatedWindow)
      throw new Error("Unrelated Electron window did not open");
    await expect(
      unrelatedWindow.evaluate(async () => {
        try {
          await navigator.clipboard.writeText("unrelated-window-write");
          return "allowed";
        } catch {
          return "denied";
        }
      }),
    ).resolves.toBe("denied");

    await expect
      .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(expectedPath);
  } finally {
    await electronApp.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
