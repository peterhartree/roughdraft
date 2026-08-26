import { expect, test } from "@playwright/test";
import {
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  richTextEditor,
  selectRichText,
  writeProjectFile,
} from "./helpers";

test.describe("table row deletion", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("table-row-delete");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("deletes the current table row from the context menu", async ({
    page,
  }) => {
    const markdown = [
      "| Name | Role |",
      "| --- | --- |",
      "| Alpha | First |",
      "| Beta | Second |",
      "",
    ].join("\n");
    const filePath = writeProjectFile(projectDir, "table.md", markdown);

    await openMarkdownFile(page, filePath);
    const editor = richTextEditor(page);
    await expect(editor).toContainText("Beta");

    const targetCell = editor.getByRole("cell", { name: "Beta" });
    await targetCell.click();
    await targetCell.click({ button: "right" });

    const deleteRow = page.getByTestId("editor-context-menu-action-delete-row");
    await expect(deleteRow).toBeEnabled();
    await deleteRow.click();

    await expect(editor).not.toContainText("Beta");
    await expect(editor).toContainText("Alpha");

    await expect(() => {
      const saved = readProjectFile(projectDir, "table.md");
      expect(saved).not.toContain("Beta");
      expect(saved).toContain("Alpha");
    }).toPass();

    logE2eEvent("table-row-delete.row-removed", { file: "table.md" });
  });

  test("deletes the current table row from the selection menu", async ({
    page,
  }) => {
    const markdown = [
      "| Name | Role |",
      "| --- | --- |",
      "| Alpha | First |",
      "| Beta | Second |",
      "",
    ].join("\n");
    const filePath = writeProjectFile(projectDir, "table.md", markdown);

    await openMarkdownFile(page, filePath);
    const editor = richTextEditor(page);
    await expect(editor).toContainText("Beta");

    await selectRichText(page, "Beta");
    const deleteRow = page.getByTestId(
      "selection-menu-action-delete-table-row",
    );
    await expect(deleteRow).toBeVisible();
    await deleteRow.click();

    await expect(editor).not.toContainText("Beta");
    await expect(editor).toContainText("Alpha");
  });

  test("hides the selection menu delete row action outside tables", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "prose.md",
      "# Heading\n\nJust prose here.\n",
    );

    await openMarkdownFile(page, filePath);
    await expect(richTextEditor(page)).toContainText("Just prose here.");

    await selectRichText(page, "prose");
    await expect(page.getByTestId("selection-menu")).toBeVisible();
    await expect(
      page.getByTestId("selection-menu-action-delete-table-row"),
    ).toHaveCount(0);
  });

  test("keeps the context menu fully visible near the viewport edge", async ({
    page,
  }) => {
    const markdown = [
      "| Name | Role |",
      "| --- | --- |",
      "| Alpha | First |",
      "| Beta | Second |",
      "",
    ].join("\n");
    const filePath = writeProjectFile(projectDir, "table.md", markdown);

    await page.setViewportSize({ width: 700, height: 500 });
    await openMarkdownFile(page, filePath);
    const editor = richTextEditor(page);
    await expect(editor).toContainText("Beta");

    const targetCell = editor.getByRole("cell", { name: "Beta" });
    await targetCell.click();

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("Viewport size unavailable");

    const editorBox = await editor.boundingBox();
    if (!editorBox) throw new Error("Editor bounding box unavailable");

    // Right-click near the editor's bottom-right corner so an unclamped
    // menu would overflow the viewport.
    await page.mouse.click(
      Math.min(editorBox.x + editorBox.width, viewport.width) - 8,
      Math.min(editorBox.y + editorBox.height, viewport.height) - 8,
      { button: "right" },
    );

    const menu = page.getByTestId("editor-context-menu");
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    if (!box) throw new Error("Context menu bounding box unavailable");

    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  });

  test("hides the delete row action outside tables", async ({ page }) => {
    const filePath = writeProjectFile(
      projectDir,
      "prose.md",
      "# Heading\n\nJust prose.\n",
    );

    await openMarkdownFile(page, filePath);
    const editor = richTextEditor(page);
    await expect(editor).toContainText("Just prose.");

    await editor.getByText("Just prose.").click();
    await editor.getByText("Just prose.").click({ button: "right" });

    await expect(page.getByTestId("editor-context-menu")).toBeVisible();
    await expect(
      page.getByTestId("editor-context-menu-action-delete-row"),
    ).toHaveCount(0);
  });
});
