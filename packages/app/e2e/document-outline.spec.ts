import { expect, type Page, test } from "@playwright/test";
import {
  createMarkdownProject,
  openMarkdownFile,
  removeMarkdownProject,
  writeProjectFile,
} from "./helpers";

const FILLER =
  "Filler paragraph with enough words to fill a line of the text column and push the next heading further down the page.";

function outlinedDocument() {
  const section = (heading: string) => [
    heading,
    "",
    ...Array(8).fill(`${FILLER}\n`),
  ];
  return [
    "# Strategy and impact",
    "",
    ...section("## Summary"),
    ...section("## The impact model"),
    ...section("### Three priorities"),
    ...section("### Audience and comms"),
    ...section("## Delivery in detail"),
    ...section("## Open questions"),
    // Enough trailing text for the last section to scroll to the top.
    ...Array(30).fill(`${FILLER}\n`),
  ].join("\n");
}

function headingInEditor(page: Page, text: string) {
  return page
    .getByTestId("rich-text-editor")
    .locator("h2, h3", { hasText: text }); // selector-check-ignore -- the rendered heading is the jump target
}

/** Heading top relative to the workspace scroller's visible top. */
async function headingOffsetFromTop(page: Page, text: string) {
  const workspace = await page
    .getByTestId("document-workspace-scroll")
    .boundingBox();
  const heading = await headingInEditor(page, text).boundingBox();
  if (!workspace || !heading) throw new Error("missing geometry");
  return heading.y - workspace.y;
}

async function pressOutlineShortcut(page: Page) {
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Shift+O" : "Control+Shift+O",
  );
}

test.describe("document outline", () => {
  let projectDir: string;
  let filePath: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("document-outline");
    filePath = writeProjectFile(projectDir, "outline.md", outlinedDocument());
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("pins the outline in a wide margin and jumps to a section @smoke", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1680, height: 900 });
    await openMarkdownFile(page, filePath);

    const outline = page.getByTestId("document-outline");
    await expect(outline).toBeVisible();
    await expect(page.getByTestId("document-outline-ticks")).toHaveCount(0);
    // The single leading H1 is the title, so it is not listed.
    await expect(outline.getByTestId("document-outline-item")).toHaveText([
      "Summary",
      "The impact model",
      "Three priorities",
      "Audience and comms",
      "Delivery in detail",
      "Open questions",
    ]);

    // The outline sits in the margin, clear of the text column.
    const outlineBox = await outline.boundingBox();
    const headingBox = await headingInEditor(page, "Summary").boundingBox();
    expect(outlineBox && headingBox).toBeTruthy();
    expect((outlineBox?.x ?? 0) + (outlineBox?.width ?? 0)).toBeLessThan(
      headingBox?.x ?? 0,
    );

    const delivery = outline
      .getByTestId("document-outline-item")
      .filter({ hasText: "Delivery in detail" });
    await delivery.click();
    // The jump is instant, so the heading is in place straight after the click.
    expect(await headingOffsetFromTop(page, "Delivery in detail")).toBeLessThan(
      120,
    );
    await expect(delivery).toHaveAttribute("aria-current", "location");
  });

  test("lets wide tables pass over the pinned outline, which comes forward on hover", async ({
    page,
  }) => {
    const row = (n: number) =>
      `> | ${n} | Element ${n} | Option A, option B | **A** | Edit is findable but quiet, and only shows on the chosen option. |`;
    const tablePath = writeProjectFile(
      projectDir,
      "outline-tables.md",
      [
        "# Strategy and impact",
        "",
        "## Summary",
        "",
        ...Array(8).fill(`${FILLER}\n`),
        "## Decisions",
        "",
        FILLER,
        "",
        "> [!IMPORTANT]",
        "> **Decisions**",
        ">",
        "> | # | Element | Options | Recommendation | Why |",
        "> | --- | --- | --- | --- | --- |",
        ...[1, 2, 3, 4, 5, 6, 7, 8].map(row),
        "",
        "## Delivery in detail",
        "",
        "| Location | Before | After | Rationale | Verification |",
        "| --- | --- | --- | --- | --- |",
        "| SubscribeForm.tsx:69-77 | Fixed overlay | Shared dialog primitive | Consistent keyboard behaviour | Focus enters and returns |",
        "",
        "## Open questions",
        "",
        ...Array(30).fill(`${FILLER}\n`),
      ].join("\n"),
    );
    await page.setViewportSize({ width: 1680, height: 900 });
    await openMarkdownFile(page, tablePath);

    const outline = page.getByTestId("document-outline");
    await expect(outline).toBeVisible();
    const editor = page.getByTestId("rich-text-editor");
    const prose = editor.locator("p").first(); // selector-check-ignore -- rendered paragraph geometry is the contract
    const tables = editor.locator(".tableWrapper"); // selector-check-ignore -- Tiptap's table scroll viewport is the product boundary
    await expect(tables).toHaveCount(2);
    const box = async (locator: typeof prose) => {
      const result = await locator.boundingBox();
      if (!result) throw new Error("missing geometry");
      return result;
    };

    // Both tables break out symmetrically about the text column.
    const proseBox = await box(prose);
    const proseCentre = proseBox.x + proseBox.width / 2;
    for (const table of await tables.all()) {
      const tableBox = await box(table);
      expect(tableBox.width).toBeGreaterThan(proseBox.width * 1.3);
      expect(
        Math.abs(tableBox.x + tableBox.width / 2 - proseCentre),
      ).toBeLessThanOrEqual(12);
    }

    // Bring the callout's table up alongside the outline.
    const calloutTable = tables.first();
    const outlineBox = await box(outline);
    await page.getByTestId("document-workspace-scroll").evaluate(
      (scroller, top) => {
        scroller.scrollBy(0, top);
      },
      (await box(calloutTable)).y - outlineBox.y - 4,
    );
    const tableBox = await box(calloutTable);
    const point = {
      x: Math.max(outlineBox.x, tableBox.x) + 12,
      y: outlineBox.y + 30,
    };
    expect(point.x).toBeLessThan(outlineBox.x + outlineBox.width);
    expect(point.y).toBeGreaterThan(tableBox.y);
    const topmostIsIn = (testId: string, selector?: string) =>
      page.evaluate(
        ({ x, y, testId, selector }) => {
          const hit = document.elementFromPoint(x, y);
          return Boolean(hit?.closest(selector ?? `[data-testid="${testId}"]`));
        },
        { ...point, testId, selector },
      );

    // The table is drawn over the outline until the pointer reaches it.
    await page.mouse.move(point.x + 600, point.y);
    expect(await topmostIsIn("", ".tableWrapper")).toBe(true);

    await page.mouse.move(point.x, point.y);
    await expect.poll(() => topmostIsIn("document-outline")).toBe(true);
    await expect(outline).toHaveCSS("background-color", "rgb(255, 255, 255)");

    // Leaving the outline sends it back behind the table.
    await page.mouse.move(outlineBox.x + outlineBox.width + 600, point.y);
    await expect.poll(() => topmostIsIn("", ".tableWrapper")).toBe(true);

    // An item under the table is still reachable.
    await page.mouse.move(point.x, point.y);
    const target = outline
      .getByTestId("document-outline-item")
      .filter({ hasText: "Open questions" });
    await target.click();
    await expect(target).toHaveAttribute("aria-current", "location");
  });

  test("collapses to ticks when the margin is narrow and expands on hover @smoke", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await openMarkdownFile(page, filePath);

    const ticks = page.getByTestId("document-outline-ticks");
    await expect(ticks).toBeVisible();
    await expect(page.getByTestId("document-outline")).toHaveCount(0);

    await ticks.hover();
    const popover = page.getByTestId("document-outline-popover");
    await expect(popover).toBeVisible();
    // No room to pin at this width.
    await expect(page.getByTestId("document-outline-pin")).toHaveCount(0);

    await popover
      .getByTestId("document-outline-item")
      .filter({ hasText: "Open questions" })
      .click();
    await expect(popover).toHaveCount(0);
    await expect
      .poll(() => headingOffsetFromTop(page, "Open questions"))
      .toBeLessThan(120);
  });

  test("remembers collapsing the pinned outline to ticks", async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 900 });
    await openMarkdownFile(page, filePath);

    await page.getByTestId("document-outline").hover();
    await page.getByTestId("document-outline-collapse").click();
    await expect(page.getByTestId("document-outline")).toHaveCount(0);
    await expect(page.getByTestId("document-outline-ticks")).toBeVisible();

    await page.reload();
    // The mouse is still over the margin; move it off so hovering is explicit.
    await page.mouse.move(900, 600);
    await expect(page.getByTestId("document-outline-ticks")).toBeVisible();

    await page.getByTestId("document-outline-ticks").hover();
    await page.getByTestId("document-outline-pin").click();
    await expect(page.getByTestId("document-outline")).toBeVisible();
  });

  test("Command+Shift+O filters headings and jumps to the chosen one @smoke", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openMarkdownFile(page, filePath);
    await expect(page.getByTestId("document-outline-ticks")).toBeVisible();

    await pressOutlineShortcut(page);
    const palette = page.getByTestId("document-outline-palette");
    await expect(palette).toBeVisible();
    await page.getByTestId("document-outline-palette-input").fill("audience");
    await expect(
      palette.getByTestId("document-outline-palette-option"),
    ).toHaveText(["Audience and commsThe impact model"]);

    await page.keyboard.press("Enter");
    await expect(palette).toHaveCount(0);
    await expect
      .poll(() => headingOffsetFromTop(page, "Audience and comms"))
      .toBeLessThan(120);
    // Focus returning to the editor must not pull the view back.
    await page.waitForTimeout(400);
    expect(await headingOffsetFromTop(page, "Audience and comms")).toBeLessThan(
      120,
    );
  });

  test("shows no outline for short documents or in code view", async ({
    page,
  }) => {
    const shortPath = writeProjectFile(
      projectDir,
      "short.md",
      "# Title\n\n## Only section\n\nText.\n",
    );
    await openMarkdownFile(page, shortPath);
    await expect(page.getByTestId("rich-text-editor")).toBeVisible();
    await expect(page.getByTestId("document-outline-layer")).toHaveCount(0);

    await openMarkdownFile(page, filePath, "code");
    await expect(page.getByTestId("markdown-code-editor")).toBeVisible();
    await expect(page.getByTestId("document-outline-layer")).toHaveCount(0);
  });
});
