import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";

function activeFilePath(window: Page) {
  return window
    .locator('[data-testid="open-file-sidebar-item"][aria-current="page"]')
    .getAttribute("data-file-path");
}

test("creates and opens a new file from File > New @smoke", async () => {
  test.skip(
    process.platform !== "darwin",
    "Roughdraft Desktop is packaged and handed off on macOS.",
  );

  const apiPort = Number(process.env.API_PORT ?? 4317);
  const origin = `http://127.0.0.1:${apiPort}`;
  const temporaryDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-desktop-new-")),
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

  const notesDirectory = path.join(temporaryDirectory, "notes");
  fs.mkdirSync(notesDirectory);
  const existingFile = path.join(notesDirectory, "plan.md");
  fs.writeFileSync(existingFile, "# Plan\n");
  const newFile = path.join(notesDirectory, "ideas.md");

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
        path: existingFile,
        modifiedAt: fs.statSync(existingFile).mtimeMs,
        activate: true,
      }),
    });
    expect(response.ok).toBe(true);
    await expect.poll(() => activeFilePath(window)).toBe(existingFile);

    // Only the native save panel is stubbed: it records where it would have
    // opened and answers with a name typed without its extension.
    const defaultPath = await electronApp.evaluate(
      async ({ dialog, Menu }, chosenPath) => {
        let requestedDefaultPath: string | undefined;
        const fakeSaveDialog = async (
          ...args: unknown[]
        ): Promise<Electron.SaveDialogReturnValue> => {
          const options = args.at(-1) as Electron.SaveDialogOptions;
          requestedDefaultPath = options.defaultPath;
          return { canceled: false, filePath: chosenPath };
        };
        dialog.showSaveDialog = fakeSaveDialog as typeof dialog.showSaveDialog;

        const fileMenu = Menu.getApplicationMenu()?.items.find(
          (item) => item.label === "File",
        );
        const newItem = fileMenu?.submenu?.items.find(
          (item) => item.label === "New…",
        );
        if (!newItem) throw new Error("File > New… is missing");
        newItem.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        return requestedDefaultPath;
      },
      newFile.slice(0, -".md".length),
    );

    expect(defaultPath).toBe(path.join(notesDirectory, "Untitled.md"));
    await expect.poll(() => activeFilePath(window)).toBe(newFile);
    expect(fs.readFileSync(newFile, "utf8")).toBe("");
    expect(fs.readFileSync(existingFile, "utf8")).toBe("# Plan\n");
    await expect(window.getByTestId("document-save-status")).toHaveAttribute(
      "aria-label",
      "Saved",
    );
  } finally {
    await electronApp.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
