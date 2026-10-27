import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

// The desktop shell replaces every Roughdraft page's Content Security Policy
// with one that blocks inline scripts, so this checks that the live-HTML frame
// keeps its own policy there: the widget's script runs, and the network stays
// closed to it.
test("runs a live HTML fence's script in the desktop app @smoke", async () => {
  test.skip(
    process.platform !== "darwin",
    "Roughdraft Desktop is packaged and handed off on macOS.",
  );

  const apiPort = Number(process.env.API_PORT ?? 4317);
  const origin = `http://127.0.0.1:${apiPort}`;
  const temporaryDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-desktop-live-html-")),
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

  const filePath = path.join(temporaryDirectory, "widget.md");
  fs.writeFileSync(
    filePath,
    [
      "# Widget",
      "",
      "```html live",
      '<p data-testid="status">Script did not run</p>',
      "<script>",
      '  const status = document.querySelector("[data-testid=status]");',
      '  status.textContent = "Script ran";',
      "  fetch(location.origin + '/api/health').then(",
      '    () => { status.dataset.network = "open"; },',
      '    () => { status.dataset.network = "closed"; },',
      "  );",
      "</script>",
      "```",
      "",
    ].join("\n"),
  );

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

    const status = window
      .frameLocator('[data-testid="live-html-frame"]')
      .getByTestId("status");
    await expect(status).toHaveText("Script ran");
    await expect(status).toHaveAttribute("data-network", "closed");
    // Closing while a save is pending trips the unsaved-changes guard.
    await expect(window.getByTestId("document-save-status")).toHaveAttribute(
      "aria-label",
      "Saved",
    );
  } finally {
    await electronApp.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
