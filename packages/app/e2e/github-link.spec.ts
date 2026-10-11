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

const README = "context/strategy/README.md";
const PARAGRAPHS =
  "# Strategy\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n";

// The repository's origin URL is on GitHub, so Roughdraft treats it as a
// GitHub repository, while an `insteadOf` rewrite sends fetches and pushes to
// a local bare repository.
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
  const filePath = writeProjectFile(repoDir, README, PARAGRAPHS);
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
  git(
    repoDir,
    "config",
    `url.${remoteDir}.insteadOf`,
    "git@github.com:HartreeWorks/example.git",
  );
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
  let clones = 0;
  /** Commits a change to origin from another clone, as a colleague would. */
  const pushFromElsewhere = (relativePath: string, content: string) => {
    clones += 1;
    const cloneDir = path.join(projectDir, `elsewhere-${clones}`);
    git(projectDir, "clone", "--quiet", remoteDir, cloneDir);
    git(cloneDir, "config", "user.name", "Max");
    git(cloneDir, "config", "user.email", "max@example.com");
    git(cloneDir, "config", "commit.gpgsign", "false");
    writeProjectFile(cloneDir, relativePath, content);
    git(cloneDir, "add", relativePath);
    git(cloneDir, "commit", "--quiet", "-m", `edit ${relativePath}`);
    git(cloneDir, "push", "--quiet");
  };
  return { repoDir, remoteDir, filePath, remoteFile, pushFromElsewhere };
}

/** Opens a file the way the CLI does, switching in place without a reload. */
async function requestOpen(filePath: string) {
  const apiPort = Number(process.env.API_PORT ?? 4317);
  const response = await fetch(`http://127.0.0.1:${apiPort}/api/open-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: filePath,
      modifiedAt: fs.statSync(filePath).mtimeMs,
      activate: true,
    }),
  });
  expect(response.ok).toBe(true);
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

  test("explains a refused push and keeps offering to push", async ({
    page,
  }) => {
    const repo = createPushedRepo(projectDir);
    writeProjectFile(
      repo.remoteDir,
      "hooks/pre-receive",
      "#!/bin/sh\necho 'Branch is protected' >&2\nexit 1\n",
    );
    fs.chmodSync(path.join(repo.remoteDir, "hooks/pre-receive"), 0o755);
    fs.appendFileSync(repo.filePath, "Local edit\n");

    await openMarkdownFile(page, repo.filePath);
    const pushButton = page.getByTestId("document-github-push-button");
    await pushButton.click();

    await expect(page.getByTestId("document-github-push-error")).toContainText(
      "Committed, but the push failed.",
    );
    await expect(pushButton).toHaveAttribute(
      "aria-label",
      "Push 1 commit to GitHub",
    );
  });

  test("takes GitHub's newer version on opening an unchanged copy, and marks what changed @smoke", async ({
    page,
  }) => {
    const repo = createPushedRepo(projectDir);
    repo.pushFromElsewhere(
      README,
      PARAGRAPHS.replace(
        "Second paragraph.",
        "Second paragraph, revised on GitHub.",
      ),
    );

    await openMarkdownFile(page, repo.filePath);

    await expect(richTextEditor(page)).toContainText(
      "Second paragraph, revised on GitHub.",
    );
    const banner = page.getByTestId("document-github-banner");
    await expect(banner).toHaveAttribute("data-kind", "updated");
    await expect(banner).toContainText("Updated README.md from GitHub");
    await expect(banner).toContainText("1 new commit from Max");
    const marks = page.getByTestId("github-change-mark");
    await expect(marks).toHaveCount(1);
    await expect(marks).toHaveText("Second paragraph, revised on GitHub.");
    await expect(page.getByTestId("document-github-link")).toHaveAttribute(
      "data-sync",
      "synced",
    );
  });

  test("takes GitHub's newer version when the window regains focus", async ({
    page,
  }) => {
    const repo = createPushedRepo(projectDir);
    await openMarkdownFile(page, repo.filePath);
    await expect(richTextEditor(page)).toContainText("Third paragraph.");

    repo.pushFromElsewhere(
      README,
      PARAGRAPHS.replace("Third paragraph.", "Third paragraph, from GitHub."),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));

    await expect(richTextEditor(page)).toContainText(
      "Third paragraph, from GitHub.",
    );
    await expect(page.getByTestId("github-change-mark")).toHaveText(
      "Third paragraph, from GitHub.",
    );
  });

  test("asks before combining GitHub's version with edits here", async ({
    page,
  }) => {
    const repo = createPushedRepo(projectDir);
    repo.pushFromElsewhere(
      README,
      PARAGRAPHS.replace("Third paragraph.", "Third paragraph, from GitHub."),
    );
    fs.writeFileSync(
      repo.filePath,
      PARAGRAPHS.replace("First paragraph.", "First paragraph, edited here."),
    );

    await openMarkdownFile(page, repo.filePath);
    const banner = page.getByTestId("document-github-banner");
    await expect(banner).toHaveAttribute("data-kind", "warning");
    await expect(banner).toContainText(
      "GitHub and this copy both changed README.md",
    );
    // Nothing is combined until asked.
    await expect(richTextEditor(page)).not.toContainText("from GitHub");
    await expect(
      page.getByTestId("document-github-update-button"),
    ).toBeVisible();

    await page.getByTestId("document-github-banner-update").click();

    await expect(richTextEditor(page)).toContainText(
      "Third paragraph, from GitHub.",
    );
    await expect(richTextEditor(page)).toContainText(
      "First paragraph, edited here.",
    );
    await expect(banner).toHaveAttribute("data-kind", "updated");
    await expect(page.getByTestId("document-github-push-button")).toBeVisible();
  });

  test("explains when edits here and on GitHub clash, and changes nothing", async ({
    page,
  }) => {
    const repo = createPushedRepo(projectDir);
    repo.pushFromElsewhere(
      README,
      PARAGRAPHS.replace("Second paragraph.", "Second paragraph, theirs."),
    );
    const mine = PARAGRAPHS.replace(
      "Second paragraph.",
      "Second paragraph, mine.",
    );
    fs.writeFileSync(repo.filePath, mine);

    await openMarkdownFile(page, repo.filePath);
    await page.getByTestId("document-github-banner-update").click();

    await expect(
      page.getByTestId("document-github-banner-error"),
    ).toContainText(
      "Your edits and GitHub's change the same lines of context/strategy/README.md",
    );
    expect(fs.readFileSync(repo.filePath, "utf8")).toBe(mine);
    await expect(richTextEditor(page)).toContainText("Second paragraph, mine.");
  });

  test("hides the banner until GitHub changes again", async ({ page }) => {
    const repo = createPushedRepo(projectDir);
    repo.pushFromElsewhere(
      README,
      PARAGRAPHS.replace("Third paragraph.", "Third paragraph, from GitHub."),
    );
    fs.writeFileSync(
      repo.filePath,
      PARAGRAPHS.replace("First paragraph.", "First paragraph, edited here."),
    );

    await openMarkdownFile(page, repo.filePath);
    await page.getByTestId("document-github-banner-dismiss").click();

    await expect(page.getByTestId("document-github-banner")).toHaveCount(0);
    await expect(
      page.getByTestId("document-github-update-button"),
    ).toBeVisible();

    repo.pushFromElsewhere(
      README,
      PARAGRAPHS.replace("Third paragraph.", "Third paragraph, again."),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("document-github-banner")).toHaveAttribute(
      "data-kind",
      "warning",
    );
  });

  test("shows only the active file's link after switching files in place", async ({
    page,
  }) => {
    const repo = createPushedRepo(projectDir);
    const newPath = writeProjectFile(repo.repoDir, "plans/new.md", "# New\n");

    await openMarkdownFile(page, repo.filePath);
    await expect(page.getByTestId("document-github-link")).toHaveAttribute(
      "data-sync",
      "synced",
    );
    await requestOpen(newPath);

    await expect(page.getByTestId("document-github-link")).toHaveAttribute(
      "data-sync",
      "not-pushed",
    );
    await requestOpen(repo.filePath);
    await expect(page.getByTestId("document-github-link")).toHaveAttribute(
      "href",
      README_URL,
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
