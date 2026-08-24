import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  codeEditor,
  createMarkdownProject,
  documentSaveStatus,
  fileConflictNotice,
  logE2eEvent,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  writeProjectFile,
} from "./helpers";

function postOpenRequest(page: Page, filePath: string) {
  let modifiedAt: number | null;
  try {
    modifiedAt = fs.statSync(filePath).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    modifiedAt = null;
  }

  return page.request.post("/api/open-request", {
    data: {
      path: filePath,
      modifiedAt,
    },
  });
}

async function openFileItem(page: Page, filePath: string) {
  const items = page.getByTestId("open-file-sidebar-item");
  const paths = await items.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.filePath),
  );
  const index = paths.indexOf(filePath);
  expect(index).toBeGreaterThanOrEqual(0);
  return items.nth(index);
}

test.describe("missing file recovery", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("missing-file");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("deleting the active file surfaces the missing state and keeps sidebar navigation working @smoke", async ({
    page,
  }) => {
    const otherPath = writeProjectFile(
      projectDir,
      "other.md",
      "# Other\n\nOther body.\n",
    );
    const doomedPath = writeProjectFile(
      projectDir,
      "doomed.md",
      "# Doomed\n\nDoomed body.\n",
    );

    await openMarkdownFile(page, otherPath, "code");
    await expect(codeEditor(page)).toContainText("Other body.");
    await postOpenRequest(page, doomedPath);
    await expect(codeEditor(page)).toContainText("Doomed body.");

    fs.rmSync(doomedPath);

    const conflictNotice = fileConflictNotice(page);
    await expect(conflictNotice).toBeVisible();
    await expect(conflictNotice).toContainText("File deleted on disk");
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      "File deleted on disk",
    );
    await expect(
      page.getByTestId("file-conflict-action-keep-editing"),
    ).toBeHidden();

    const sidebarItem = await openFileItem(page, otherPath);
    await sidebarItem.click();
    await expect(codeEditor(page)).toContainText("Other body.");
    await expect(conflictNotice).toBeHidden();

    logE2eEvent("missing-file.navigation-unblocked", {
      file: "doomed.md",
    });
  });

  test("save draft to disk recreates the deleted file", async ({ page }) => {
    const doomedPath = writeProjectFile(
      projectDir,
      "recreate.md",
      "# Recreate\n\nDraft body.\n",
    );

    await openMarkdownFile(page, doomedPath, "code");
    await expect(codeEditor(page)).toContainText("Draft body.");

    fs.rmSync(doomedPath);

    const conflictNotice = fileConflictNotice(page);
    await expect(conflictNotice).toBeVisible();
    await expect(conflictNotice).toContainText("File deleted on disk");

    const overwriteButton = page.getByTestId("file-conflict-action-overwrite");
    await expect(overwriteButton).toContainText("Save draft to disk");
    await overwriteButton.click();

    await expect(conflictNotice).toBeHidden();
    await expect
      .poll(() => readProjectFile(projectDir, "recreate.md"))
      .toContain("Draft body.");

    logE2eEvent("missing-file.draft-recreated", {
      file: "recreate.md",
      size: fs.statSync(path.join(projectDir, "recreate.md")).size,
    });
  });
});
