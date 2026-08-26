import { expect, test } from "@playwright/test";
import {
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  richTextEditor,
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
