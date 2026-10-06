import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  createMarkdownProject,
  openMarkdownFile,
  removeMarkdownProject,
  simulateBackgroundWindow,
  writeProjectFile,
} from "./helpers";

function browserFile(page: Page, filePath: string) {
  return page.locator(
    `[data-testid="file-browser-file"][data-browser-path="${filePath}"]`,
  );
}

function browserFolder(page: Page, folderPath: string) {
  return page.locator(
    `[data-browser-kind="directory"][data-browser-path="${folderPath}"]`,
  );
}

function openListItem(page: Page, filePath: string) {
  return page.locator(
    `[data-testid="open-file-sidebar-item"][data-file-path="${filePath}"]`,
  );
}

test.describe("file browser", () => {
  let projectDir: string;
  let readmePath: string;
  let guidePath: string;
  let decisionPath: string;

  test.beforeEach(async ({ page }) => {
    await simulateBackgroundWindow(page);
    projectDir = createMarkdownProject("file-browser");
    fs.mkdirSync(path.join(projectDir, ".git"));
    readmePath = writeProjectFile(projectDir, "README.md", "# Readme\n");
    guidePath = writeProjectFile(projectDir, "docs/guide.md", "# Guide\n");
    decisionPath = writeProjectFile(
      projectDir,
      "docs/adr/0001-decision.md",
      "# Decision\n",
    );
    writeProjectFile(
      projectDir,
      "node_modules/pkg/README.md",
      "# Dependency\n",
    );
    writeProjectFile(projectDir, "notes.txt", "Not Markdown\n");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("browses the active file's git project and opens a file from it @smoke", async ({
    page,
  }) => {
    await openMarkdownFile(page, readmePath);

    const root = page.getByTestId("file-browser-root").first();
    await expect(root).toContainText(path.basename(projectDir));
    await expect(browserFile(page, readmePath)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      page.getByTestId("file-browser").getByText("node_modules"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("file-browser").getByText("notes.txt"),
    ).toHaveCount(0);

    await browserFolder(page, path.join(projectDir, "docs")).click();
    await browserFile(page, guidePath).click();

    await expect(page).toHaveURL(new RegExp(encodeURIComponent(guidePath)));
    await expect(openListItem(page, guidePath)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("open-file-sidebar-item")).toHaveCount(2);
    await expect(browserFile(page, guidePath)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("reveals the active file's folders when it is opened", async ({
    page,
  }) => {
    await openMarkdownFile(page, decisionPath);

    await expect(browserFile(page, decisionPath)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      browserFolder(page, path.join(projectDir, "docs", "adr")),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test("pins a project above the current project and keeps it after a reload", async ({
    page,
  }) => {
    const otherProjectDir = createMarkdownProject("file-browser-other");
    const otherPath = writeProjectFile(
      otherProjectDir,
      "notes.md",
      "# Notes\n",
    );
    try {
      await openMarkdownFile(page, readmePath);
      await page
        .getByTestId("file-browser-project-root")
        .getByTestId("file-browser-root")
        .click({ button: "right" });
      await page.getByTestId("file-browser-pin").click();

      const pinnedRoot = page.getByTestId("file-browser-pin-root");
      await expect(pinnedRoot.getByTestId("file-browser-root")).toContainText(
        path.basename(projectDir),
      );
      await expect(page.getByTestId("file-browser")).toContainText(
        `${path.basename(projectDir)} is pinned above.`,
      );

      await openMarkdownFile(page, otherPath);
      const projectRoot = page.getByTestId("file-browser-project-root");
      await expect(projectRoot).toContainText(path.basename(otherProjectDir));
      const pinnedBox = await pinnedRoot.boundingBox();
      const projectBox = await projectRoot.boundingBox();
      expect(pinnedBox?.y ?? 0).toBeLessThan(projectBox?.y ?? 0);

      await page.reload();
      await pinnedRoot
        .getByTestId("file-browser-root")
        .click({ button: "right" });
      await page.getByTestId("file-browser-unpin").click();
      await expect(pinnedRoot).toHaveCount(0);
    } finally {
      removeMarkdownProject(otherProjectDir);
    }
  });

  test("pins files and folders to the top of their project", async ({
    page,
  }) => {
    await openMarkdownFile(page, readmePath);
    const docsPath = path.join(projectDir, "docs");
    const adrPath = path.join(docsPath, "adr");
    const projectRoot = page.getByTestId("file-browser-project-root");

    await browserFolder(page, docsPath).click();
    await browserFolder(page, adrPath).click({ button: "right" });
    await page.getByTestId("file-browser-pin-to-top").click();
    await browserFile(page, guidePath).first().click({ button: "right" });
    await page.getByTestId("file-browser-pin-to-top").click();

    const pins = projectRoot.getByTestId("file-browser-project-pins");
    const pinnedPaths = () =>
      pins
        .locator(":scope > li > [data-browser-path]")
        .evaluateAll((elements) =>
          elements.map(
            (element) => (element as HTMLElement).dataset.browserPath,
          ),
        );
    await expect.poll(pinnedPaths).toEqual([adrPath, guidePath]);
    await expect(pins).toContainText("docs");

    await page.reload();
    await expect.poll(pinnedPaths).toEqual([adrPath, guidePath]);

    await pins
      .locator(`[data-browser-path="${guidePath}"]`)
      .click({ button: "right" });
    await page.getByTestId("file-browser-unpin-from-top").click();
    await expect.poll(pinnedPaths).toEqual([adrPath]);
  });

  test("moves a file to the Trash from the browser without confirmation", async ({
    page,
  }) => {
    await openMarkdownFile(page, readmePath);
    await browserFolder(page, path.join(projectDir, "docs")).click();
    await browserFile(page, guidePath).click({ button: "right" });
    await page.getByTestId("file-browser-move-to-trash").click();

    await expect.poll(() => fs.existsSync(guidePath)).toBe(false);
    await expect(browserFile(page, guidePath)).toHaveCount(0);
    await expect(openListItem(page, readmePath)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("moves an inactive open file to the Trash from the Open list", async ({
    page,
  }) => {
    await openMarkdownFile(page, readmePath);
    await browserFolder(page, path.join(projectDir, "docs")).click();
    await browserFile(page, guidePath).click();
    await expect(openListItem(page, guidePath)).toHaveAttribute(
      "aria-current",
      "page",
    );

    await openListItem(page, readmePath).click({ button: "right" });
    await page.getByTestId("open-file-sidebar-move-to-trash").click();

    await expect.poll(() => fs.existsSync(readmePath)).toBe(false);
    await expect(openListItem(page, readmePath)).toHaveCount(0);
    await expect(openListItem(page, guidePath)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("moves the active file to the Trash from the top bar after an inline confirmation @smoke", async ({
    page,
  }) => {
    await openMarkdownFile(page, readmePath);
    await browserFolder(page, path.join(projectDir, "docs")).click();
    await browserFile(page, guidePath).click();
    await expect(openListItem(page, guidePath)).toHaveAttribute(
      "aria-current",
      "page",
    );

    const trashButton = page.getByTestId("document-move-to-trash-button");
    await trashButton.click();
    await expect(trashButton).toHaveAttribute("data-state", "armed");
    await expect(trashButton).toContainText("Move to Trash?");
    expect(fs.existsSync(guidePath)).toBe(true);

    await trashButton.click();
    await expect.poll(() => fs.existsSync(guidePath)).toBe(false);
    await expect(openListItem(page, guidePath)).toHaveCount(0);
    await expect(openListItem(page, readmePath)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("returns to recent documents after moving the last open file to the Trash", async ({
    page,
  }) => {
    await openMarkdownFile(page, readmePath);
    const trashButton = page.getByTestId("document-move-to-trash-button");
    await trashButton.click();
    await trashButton.click();

    await expect(page.getByTestId("recent-documents")).toBeVisible();
    expect(fs.existsSync(readmePath)).toBe(false);
    await expect(
      page.locator(
        `[data-testid="recent-document-item"][data-file-path="${readmePath}"]`,
      ),
    ).toHaveCount(0);
  });

  test("shows pinned folders beside recent documents when nothing is open", async ({
    page,
  }) => {
    await page.addInitScript((folder) => {
      window.localStorage.setItem(
        "roughdraft.file-browser.v1",
        JSON.stringify({ pinnedFolders: [folder] }),
      );
    }, projectDir);
    await page.goto("/");

    await expect(page.getByTestId("recent-documents")).toBeVisible();
    await expect(page.getByTestId("file-browser-root")).toContainText(
      path.basename(projectDir),
    );

    await browserFile(page, readmePath).click();
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(readmePath)));
    await expect(openListItem(page, readmePath)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("steps between open files with Command-Option-Left and Right", async ({
    page,
  }) => {
    await openMarkdownFile(page, readmePath);
    await browserFolder(page, path.join(projectDir, "docs")).click();
    await browserFile(page, guidePath).click();
    await expect(openListItem(page, guidePath)).toHaveAttribute(
      "aria-current",
      "page",
    );

    // The guide was opened last, so it sits above the readme.
    await page.keyboard.press("Meta+Alt+ArrowRight");
    await expect(openListItem(page, readmePath)).toHaveAttribute(
      "aria-current",
      "page",
    );

    // The readme is last in the list, so stepping further does nothing.
    await page.keyboard.press("Meta+Alt+ArrowRight");
    await expect(openListItem(page, readmePath)).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.keyboard.press("Meta+Alt+ArrowLeft");
    await expect(openListItem(page, guidePath)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("folds the browse section and remembers it", async ({ page }) => {
    await openMarkdownFile(page, readmePath);
    const browseHeader = page
      .getByTestId("file-browser-section")
      .getByRole("button", { name: "Browse", exact: true });

    await browseHeader.click();
    await expect(browseHeader).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("file-browser")).toHaveCount(0);

    await page.reload();
    await expect(
      page
        .getByTestId("file-browser-section")
        .getByRole("button", { name: "Browse", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
