import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { logE2eEvent, richTextEditor, selectRichText } from "./helpers";

test("writes to the system clipboard through the Electron permission boundary @smoke", async () => {
  test.skip(
    process.platform !== "darwin",
    "Roughdraft Desktop is packaged and handed off on macOS.",
  );

  const apiPort = Number(process.env.API_PORT ?? 4317);
  const origin = `http://localhost:${apiPort}`;
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "roughdraft-desktop-clipboard-"),
  );
  const stateFile = path.join(temporaryDirectory, "server.json");
  const userDataDirectory = path.join(temporaryDirectory, "electron-profile");
  const status = await fetch(`${origin}/api/status`).then((response) =>
    response.json(),
  );
  // The desktop startup CLI validates this state before reusing the test server.
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
      `--user-data-dir=${userDataDirectory}`,
    ],
    env: {
      ...process.env,
      ROUGHDRAFT_STATE_FILE: stateFile,
    },
  });

  try {
    const window = await electronApp.firstWindow();
    await expect(window).toHaveURL(`${origin}/`);

    const expectedPath = "/Users/me/project/electron-clipboard.md";
    await window.evaluate(
      (text) => navigator.clipboard.writeText(text),
      expectedPath,
    );

    await expect
      .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(expectedPath);

    const documentPath = path.join(temporaryDirectory, "copy.md");
    const markdown = "Before **selected text** after.\n";
    fs.writeFileSync(documentPath, markdown);
    const params = new URLSearchParams({ path: documentPath });
    await window.goto(`${origin}/?${params}`);
    await expect(richTextEditor(window)).toContainText("selected text");

    for (const [action, expected] of [
      ["copy", "selected text"],
      ["copy-as-markdown", "**selected text**"],
    ]) {
      await selectRichText(window, "selected text");
      await richTextEditor(window)
        .getByText("selected text", { exact: true })
        .click({ button: "right" });
      await window.getByTestId(`editor-context-menu-action-${action}`).click();
      await expect
        .poll(() =>
          electronApp.evaluate(({ clipboard }) => clipboard.readText()),
        )
        .toBe(expected);
      if (action === "copy") {
        // The system clipboard carries HTML too, so pasting into Slack keeps bold.
        expect(
          await electronApp.evaluate(({ clipboard }) => clipboard.readHTML()),
        ).toContain("<strong>selected text</strong>");
      }
      await expect(window.getByTestId("editor-context-menu")).toBeHidden();
      expect(fs.readFileSync(documentPath, "utf8")).toBe(markdown);
      logE2eEvent("desktop.context-menu.copy", {
        action,
        characters: expected.length,
        documentUnchanged: true,
      });
    }

    for (const [shortcut, expected] of [
      ["Meta+c", "selected text"],
      ["Meta+Shift+c", "**selected text**"],
    ]) {
      await electronApp.evaluate(({ clipboard }) =>
        clipboard.writeText("before shortcut"),
      );
      await selectRichText(window, "selected text");
      await window.keyboard.press(shortcut);
      await expect
        .poll(() =>
          electronApp.evaluate(({ clipboard }) => clipboard.readText()),
        )
        .toBe(expected);
      expect(fs.readFileSync(documentPath, "utf8")).toBe(markdown);
      logE2eEvent("desktop.keyboard.copy", {
        shortcut,
        characters: expected.length,
        documentUnchanged: true,
      });
    }

    await electronApp.evaluate(async ({ BrowserWindow }, origin) => {
      const unrelatedWindow = new BrowserWindow({ show: false });
      await unrelatedWindow.loadURL(origin);
    }, `${origin}/`);
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
      .toBe("**selected text**");
  } finally {
    await electronApp.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
