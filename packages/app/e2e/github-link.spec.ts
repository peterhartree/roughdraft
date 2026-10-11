import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import {
  createMarkdownProject,
  openMarkdownFile,
  removeMarkdownProject,
  richTextEditor,
  writeProjectFile,
} from "./helpers";

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

test.describe("View on GitHub link", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("github-link");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("opens the file's GitHub page in a new window @smoke", async ({
    page,
    context,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "context/strategy/README.md",
      "# Strategy\n",
    );
    git(projectDir, "init", "--quiet", "--initial-branch=main");
    git(
      projectDir,
      "remote",
      "add",
      "origin",
      "git@github.com:HartreeWorks/example.git",
    );
    git(projectDir, "add", ".");
    git(projectDir, "commit", "--quiet", "-m", "init");
    const expectedUrl =
      "https://github.com/HartreeWorks/example/blob/main/context/strategy/README.md";
    await context.route("https://github.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "GitHub" }),
    );

    await openMarkdownFile(page, filePath);
    const link = page.getByTestId("document-github-link");
    await expect(link).toHaveAttribute("href", expectedUrl);
    await expect(link).toHaveAttribute("target", "_blank");

    const popupOpened = page.waitForEvent("popup");
    await link.click();
    const popup = await popupOpened;
    expect(popup.url()).toBe(expectedUrl);
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
