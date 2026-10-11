import { execFileSync } from "node:child_process";
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

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
}

test("opens the GitHub link in the default browser, not the app window", async () => {
  test.skip(
    process.platform !== "darwin",
    "Roughdraft Desktop is packaged and handed off on macOS.",
  );

  const apiPort = Number(process.env.API_PORT ?? 4317);
  const origin = `http://127.0.0.1:${apiPort}`;
  const temporaryDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-desktop-github-link-")),
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

  const repoDirectory = path.join(temporaryDirectory, "repo");
  const documentPath = path.join(repoDirectory, "docs", "plan.md");
  fs.mkdirSync(path.dirname(documentPath), { recursive: true });
  fs.writeFileSync(documentPath, "# Plan\n");
  // A GitHub origin URL with a local push URL, so the file can be pushed
  // without leaving this machine.
  const remoteDirectory = path.join(temporaryDirectory, "remote.git");
  git(
    temporaryDirectory,
    "init",
    "--quiet",
    "--bare",
    "--initial-branch=main",
    remoteDirectory,
  );
  git(repoDirectory, "init", "--quiet", "--initial-branch=main");
  git(repoDirectory, "remote", "add", "origin", "git@github.com:o/r.git");
  git(repoDirectory, "config", "remote.origin.pushurl", remoteDirectory);
  git(repoDirectory, "add", "docs/plan.md");
  git(repoDirectory, "commit", "--quiet", "--no-verify", "-m", "init");
  git(repoDirectory, "push", "--quiet", "--set-upstream", "origin", "main");

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

    const link = window.getByTestId("document-github-link");
    await expect(link).toBeVisible();
    const documentUrl = window.url();

    await link.click();

    await expect
      .poll(() => externalOpens(electronApp))
      .toEqual(["https://github.com/o/r/blob/main/docs/plan.md"]);
    expect(electronApp.windows()).toHaveLength(1);
    expect(window.url()).toBe(documentUrl);
  } finally {
    await electronApp.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
