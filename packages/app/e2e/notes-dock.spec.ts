import { expect, type Page, test } from "@playwright/test";
import {
  captureResponsiveScreenshots,
  createMarkdownProject,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  richTextEditor,
  writeProjectFile,
} from "./helpers";

const FILLER =
  "Filler paragraph with enough words to fill a line of the text column and push the next heading further down the page.";

function memo() {
  const section = (heading: string) => [
    heading,
    "",
    ...Array(8).fill(`${FILLER}\n`),
  ];
  return [
    "# Compute governance",
    "",
    "Opening paragraph.",
    "",
    ...section("## The supply chain"),
    ...section("## The impact model"),
    ...section("## Open questions"),
    ...Array(30).fill(`${FILLER}\n`),
  ].join("\n");
}

function notesEditor(page: Page) {
  return page.getByTestId("notes-dock-editor");
}

async function openDock(page: Page) {
  await page.getByTestId("notes-dock-open").click();
  await expect(notesEditor(page)).toBeFocused();
}

/** Scrolls the document so the heading sits at the top, as a reader would. */
async function readSection(page: Page, heading: string) {
  await page
    .getByTestId("document-workspace-scroll")
    .evaluate((scroller, text) => {
      const headings = scroller.querySelectorAll("h2"); // selector-check-ignore -- the rendered heading is what the reader scrolls to
      const target = [...headings].find(
        (element) => element.textContent === text,
      );
      if (!target) throw new Error(`No heading ${text}`);
      scroller.scrollTop +=
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top;
    }, heading);
  await expect(page.getByTestId("notes-dock-reading")).toHaveText(
    `Reading § ${heading}`,
  );
}

test.describe("notes dock", () => {
  let projectDir: string;
  let filePath: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("notes-dock");
    filePath = writeProjectFile(projectDir, "memo.md", memo());
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("saves notes to the frontmatter and keeps them through body edits @smoke", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMarkdownFile(page, filePath);
    await expect(page.getByTestId("notes-dock")).toHaveAttribute(
      "data-size",
      "minimized",
    );

    await openDock(page);
    await page.keyboard.type("Strong opening, thin on costs");
    await expect
      .poll(() => readProjectFile(projectDir, "memo.md"))
      .toContain(
        "---\nnotes: |\n  Strong opening, thin on costs\n---\n\n# Compute governance\n",
      );

    // An edit to the document body must not drop the notes.
    await richTextEditor(page).getByText("Opening paragraph.").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Edited.");
    await expect
      .poll(() => readProjectFile(projectDir, "memo.md"))
      .toContain("Opening paragraph. Edited.");
    expect(readProjectFile(projectDir, "memo.md")).toContain(
      "notes: |\n  Strong opening, thin on costs\n",
    );

    // Minimised, the dock shows the first line of the notes.
    await page.getByTestId("notes-dock-minimize").click();
    await expect(page.getByTestId("notes-dock")).toContainText(
      "Strong opening, thin on costs",
    );
  });

  test("offers the section being read, and Tab links it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMarkdownFile(page, filePath);
    await openDock(page);
    await page.keyboard.type("General point");

    await readSection(page, "The impact model");
    await notesEditor(page).focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Model needs numbers");
    await expect(page.getByTestId("notes-dock-suggestion")).toContainText(
      "§ The impact model",
    );

    await page.keyboard.press("Tab");
    await expect(page.getByTestId("notes-dock-suggestion")).toHaveCount(0);
    await expect
      .poll(() => readProjectFile(projectDir, "memo.md"))
      .toContain(
        "notes: |\n  General point\n  Model needs numbers [§ The impact model](#the-impact-model)\n",
      );

    // Once taken, the same section is not offered again on the next line.
    await page.keyboard.press("Enter");
    await page.keyboard.type("Another thought");
    await expect(page.getByTestId("notes-dock-suggestion")).toHaveCount(0);
  });

  test("§ links any section, and a tag jumps back to it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMarkdownFile(page, filePath);
    await openDock(page);
    await readSection(page, "The supply chain");
    await notesEditor(page).focus();

    await page.keyboard.type("Compare with §");
    const picker = page.getByTestId("notes-dock-section-picker");
    await expect(picker).toBeVisible();
    await expect(picker).toContainText("reading now");
    await captureResponsiveScreenshots(page, {
      desktop: "notes-dock-picker-desktop.png",
      mobile: "notes-dock-picker-mobile.png",
    });
    await page.keyboard.type("open");
    await page.keyboard.press("Enter");
    await expect(picker).toHaveCount(0);
    await expect
      .poll(() => readProjectFile(projectDir, "memo.md"))
      .toContain("Compare with [§ Open questions](#open-questions)");

    await page.getByTestId("document-workspace-scroll").evaluate((scroller) => {
      scroller.scrollTop = 0;
    });
    await page.getByTestId("notes-dock-tag").click();
    await expect(page.getByTestId("notes-dock-reading")).toHaveText(
      "Reading § Open questions",
    );
  });

  test("shows notes changed in the file on disk", async ({ page }) => {
    await openMarkdownFile(page, filePath);
    await openDock(page);

    writeProjectFile(
      projectDir,
      "memo.md",
      `---\nnotes: |\n  Written elsewhere\n---\n\n${memo()}`,
    );
    await expect(notesEditor(page)).toHaveText("Written elsewhere");
  });
});
