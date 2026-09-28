import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from "@playwright/test";

function openRecentLabels(electronApp: ElectronApplication) {
  return electronApp.evaluate(({ Menu }) => {
    const fileMenu = Menu.getApplicationMenu()?.items.find(
      (item) => item.label === "File",
    );
    const openRecent = fileMenu?.submenu?.items.find(
      (item) => item.label === "Open Recent",
    );
    return openRecent?.submenu?.items.map((item) => item.label) ?? null;
  });
}

function activeFilePath(window: Page) {
  return window
    .locator('[data-testid="open-file-sidebar-item"][aria-current="page"]')
    .getAttribute("data-file-path");
}

test("lists opened documents in File > Open Recent and reopens them @smoke", async () => {
  test.skip(
    process.platform !== "darwin",
    "Roughdraft Desktop is packaged and handed off on macOS.",
  );

  const apiPort = Number(process.env.API_PORT ?? 4317);
  const origin = `http://127.0.0.1:${apiPort}`;
  const temporaryDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-desktop-recent-")),
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

  const firstFile = path.join(temporaryDirectory, "first.md");
  const secondFile = path.join(temporaryDirectory, "second.md");
  fs.writeFileSync(firstFile, "# First\n");
  fs.writeFileSync(secondFile, "# Second\n");

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
    await expect
      .poll(() => openRecentLabels(electronApp))
      .toEqual(["No recent documents"]);

    for (const filePath of [firstFile, secondFile]) {
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
      await expect.poll(() => activeFilePath(window)).toBe(filePath);
    }

    await expect
      .poll(() => openRecentLabels(electronApp))
      .toEqual(["second.md", "first.md"]);

    await electronApp.evaluate(({ Menu }) => {
      const fileMenu = Menu.getApplicationMenu()?.items.find(
        (item) => item.label === "File",
      );
      const firstRecent = fileMenu?.submenu?.items
        .find((item) => item.label === "Open Recent")
        ?.submenu?.items.find((item) => item.label === "first.md");
      if (!firstRecent) throw new Error("first.md missing from Open Recent");
      firstRecent.click();
    });

    await expect.poll(() => activeFilePath(window)).toBe(firstFile);
    // Closing mid-switch trips the unsaved-changes guard, so let it settle.
    await expect(window.getByTestId("document-save-status")).toHaveAttribute(
      "aria-label",
      "Saved",
    );
  } finally {
    await electronApp.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
