import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

// The Playwright config sets ROUGHDRAFT_DESKTOP_BACKGROUND=1, so test windows
// must neither take focus nor show over whatever the person at the machine is
// doing. On macOS an inactive window is still ordered above every other app's
// windows, so it must also be transparent and let clicks through.
test("keeps desktop test windows invisible and unfocused @smoke", async () => {
  test.skip(
    process.platform !== "darwin",
    "Roughdraft Desktop is packaged and handed off on macOS.",
  );

  const apiPort = Number(process.env.API_PORT ?? 4317);
  const origin = `http://localhost:${apiPort}`;
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "roughdraft-desktop-background-"),
  );
  const stateFile = path.join(temporaryDirectory, "server.json");
  const status = await fetch(`${origin}/api/status`).then((response) =>
    response.json(),
  );
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      port: apiPort,
      pid: status.pid,
      startedAt: new Date().toISOString(),
      url: origin,
    }),
  );

  const electronApp = await electron.launch({
    args: [
      path.resolve("packages/desktop"),
      `--user-data-dir=${path.join(temporaryDirectory, "electron-profile")}`,
    ],
    env: { ...process.env, ROUGHDRAFT_STATE_FILE: stateFile },
  });

  try {
    const window = await electronApp.firstWindow();
    await expect(window).toHaveURL(`${origin}/`);
    // Closing before the page has rendered is refused, so wait for it.
    await expect(window.getByTestId("recent-documents")).toBeVisible();
    const windowStates = () =>
      electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((browserWindow) => ({
          visible: browserWindow.isVisible(),
          focused: browserWindow.isFocused(),
          opacity: browserWindow.getOpacity(),
        })),
      );
    // Shown, so the renderer takes input, but never seen or focused.
    await expect
      .poll(windowStates)
      .toEqual([{ visible: true, focused: false, opacity: 0 }]);
  } finally {
    await electronApp.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
