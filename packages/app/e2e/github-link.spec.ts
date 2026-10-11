import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  appendInCodeEditor,
  createMarkdownProject,
  openMarkdownFile,
  removeMarkdownProject,
  richTextEditor,
  writeProjectFile,
} from "./helpers";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
  }).trim();
}

// The repository's origin URL is on GitHub, so Roughdraft treats it as a
// GitHub repository, while pushes go to a local bare repository.
function createPushedRepo(projectDir: string) {
  const repoDir = path.join(projectDir, "repo");
  const remoteDir = path.join(projectDir, "remote.git");
  const hooksDir = path.join(projectDir, "no-hooks");
  fs.mkdirSync(hooksDir);
  git(
    projectDir,
    "init",
    "--quiet",
    "--bare",
    "--initial-branch=main",
    remoteDir,
  );
  const filePath = writeProjectFile(
    repoDir,
    "context/strategy/README.md",
    "# Strategy\n",
  );
  git(repoDir, "init", "--quiet", "--initial-branch=main");
  git(repoDir, "config", "user.name", "Test");
  git(repoDir, "config", "user.email", "test@example.com");
  git(repoDir, "config", "commit.gpgsign", "false");
  git(repoDir, "config", "core.hooksPath", hooksDir);
  git(
    repoDir,
    "remote",
    "add",
    "origin",
    "git@github.com:HartreeWorks/example.git",
  );
  git(repoDir, "config", "remote.origin.pushurl", remoteDir);
  git(repoDir, "add", "context/strategy/README.md");
  git(repoDir, "commit", "--quiet", "-m", "init");
  git(repoDir, "push", "--quiet", "--set-upstream", "origin", "main");
  const remoteFile = (relativePath: string) => {
    try {
      return git(remoteDir, "show", `main:${relativePath}`);
    } catch {
      return null;
    }
  };
  return { repoDir, remoteDir, filePath, remoteFile };
}

const README_URL =
  "https://github.com/HartreeWorks/example/blob/main/context/strategy/README.md";

test.describe("GitHub link", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("github-link");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("opens a pushed file's GitHub page in a new window @smoke", async ({
    page,
    context,
  }) => {
    const { filePath } = createPushedRepo(projectDir);
    await context.route("https://github.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "GitHub" }),
    );

    await openMarkdownFile(page, filePath);
    const link = page.getByTestId("document-github-link");
    await expect(link).toHaveAttribute("href", README_URL);
    await expect(link).toHaveAttribute("data-sync", "synced");
    await expect(page.getByTestId("document-github-push-button")).toHaveCount(
      0,
    );

    const popupOpened = page.waitForEvent("popup");
    await link.click();
    expect((await popupOpened).url()).toBe(README_URL);
  });

  test("offers to commit and push once an edit is saved @smoke", async ({
    page,
  }) => {
    const repo = createPushedRepo(projectDir);

    await openMarkdownFile(page, repo.filePath, "code");
    await expect(page.getByTestId("document-github-link")).toHaveAttribute(
      "data-sync",
      "synced",
    );
    await appendInCodeEditor(page, "\nNew line from Roughdraft.\n");

    const pushButton = page.getByTestId("document-github-push-button");
    await expect(pushButton).toHaveAttribute(
      "aria-label",
      "Commit and push to GitHub",
    );
    // GitHub still has the older version, so the link keeps working.
    await expect(page.getByTestId("document-github-link")).toHaveAttribute(
      "data-sync",
      "changed",
    );

    await pushButton.click();

    await expect(page.getByTestId("document-github-link")).toHaveAttribute(
      "data-sync",
      "synced",
    );
    expect(repo.remoteFile("context/strategy/README.md")).toContain(
      "New line from Roughdraft.",
    );
    await expect(pushButton).toHaveCount(0);
  });

  test("shows a broken link for a file GitHub lacks until it is pushed", async ({
    page,
  }) => {
    const repo = createPushedRepo(projectDir);
    const newPath = writeProjectFile(repo.repoDir, "plans/new.md", "# New\n");

    await openMarkdownFile(page, newPath);
    const link = page.getByTestId("document-github-link");
    await expect(link).toHaveAttribute("data-sync", "not-pushed");
    await expect(link).toHaveAttribute(
      "aria-label",
      "Not on GitHub yet: this file hasn't been committed",
    );
    await expect(link).not.toHaveAttribute("href");

    await page.getByTestId("document-github-push-button").click();

    await expect(link).toHaveAttribute(
      "href",
      "https://github.com/HartreeWorks/example/blob/main/plans/new.md",
    );
    expect(repo.remoteFile("plans/new.md")).toBe("# New");
  });

  test("explains a rejected push and keeps offering to push", async ({
    page,
  }) => {
    const repo = createPushedRepo(projectDir);
    const otherClone = path.join(projectDir, "other-clone");
    git(projectDir, "clone", "--quiet", repo.remoteDir, otherClone);
    git(otherClone, "config", "user.name", "Other");
    git(otherClone, "config", "user.email", "other@example.com");
    writeProjectFile(otherClone, "elsewhere.md", "# Elsewhere\n");
    git(otherClone, "add", "elsewhere.md");
    git(otherClone, "commit", "--quiet", "-m", "elsewhere");
    git(otherClone, "push", "--quiet");
    fs.appendFileSync(repo.filePath, "Local edit\n");

    await openMarkdownFile(page, repo.filePath);
    const pushButton = page.getByTestId("document-github-push-button");
    await pushButton.click();

    await expect(page.getByTestId("document-github-push-error")).toHaveText(
      "Committed, but the push failed. GitHub has commits that this copy doesn't. Pull them, then push again.",
    );
    await expect(pushButton).toHaveAttribute(
      "aria-label",
      "Push 1 commit to GitHub",
    );
  });

  test("is absent for a file outside a git repository", async ({ page }) => {
    const filePath = writeProjectFile(projectDir, "loose.md", "# Loose\n");

    const lookup = page.waitForResponse((response) =>
      response.url().includes("/api/github-link?"),
    );
    await openMarkdownFile(page, filePath);
    expect(await (await lookup).json()).toEqual({ url: null });
    await expect(richTextEditor(page)).toContainText("Loose");
    await expect(page.getByTestId("document-copy-path-button")).toBeVisible();
    await expect(page.getByTestId("document-github-link")).toHaveCount(0);
  });
});
