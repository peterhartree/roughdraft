import { expect, type Page, test } from "@playwright/test";
import {
  createMarkdownProject,
  openMarkdownFile,
  removeMarkdownProject,
  writeProjectFile,
} from "./helpers";

// A chain wide enough that the text column would shrink it.
const wideDiagram = [
  "```mermaid",
  "flowchart LR",
  `  ${Array.from({ length: 10 }, (_, i) => `N${i}[Step number ${i}]`).join(" --> ")}`,
  "```",
].join("\n");

async function box(page: Page, testId: string) {
  const rect = await page.getByTestId(testId).boundingBox();
  if (!rect) throw new Error(`${testId} has no box`);
  return rect;
}

test.describe("Mermaid diagrams", () => {
  let projectDir: string;

  test.beforeEach(async ({ page }) => {
    projectDir = createMarkdownProject("mermaid-diagram");
    await page.setViewportSize({ width: 1600, height: 900 });
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  async function openDiagram(page: Page, before: string) {
    const filePath = writeProjectFile(
      projectDir,
      "diagram.md",
      `${before}\n\n${wideDiagram}\n`,
    );
    await openMarkdownFile(page, filePath);
    await expect(page.getByTestId("mermaid-full-screen")).toBeVisible();
  }

  test("a wide diagram breaks out of the text column on both sides", async ({
    page,
  }) => {
    await openDiagram(page, "# Diagram\n\nSome text.");

    const frame = await box(page, "mermaid-diagram");
    const column = await box(page, "mermaid-toolbar");
    expect(frame.x).toBeLessThan(column.x);
    expect(frame.x + frame.width).toBeGreaterThan(column.x + column.width);
  });

  test("a wide diagram breaks out to the right beside the outline", async ({
    page,
  }) => {
    await openDiagram(
      page,
      "# Title\n\n## One\n\n## Two\n\n## Three\n\nSome text.",
    );
    await expect(page.getByTestId("document-outline-layer")).toBeAttached();

    const frame = await box(page, "mermaid-diagram");
    const column = await box(page, "mermaid-toolbar");
    expect(Math.abs(frame.x - column.x)).toBeLessThan(1);
    expect(frame.x + frame.width).toBeGreaterThan(column.x + column.width);
  });

  test("Shift-scroll zooms a diagram in place and dragging moves it", async ({
    page,
  }) => {
    await openDiagram(page, "# Diagram");
    const frame = await box(page, "mermaid-diagram");
    const before = await box(page, "mermaid-canvas");
    await page.mouse.move(
      frame.x + frame.width / 2,
      frame.y + frame.height / 2,
    );

    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, -300);
    await page.keyboard.up("Shift");
    const zoomed = await box(page, "mermaid-canvas");
    expect(zoomed.width).toBeGreaterThan(before.width * 1.5);
    await expect(page.getByTestId("mermaid-zoom-reset")).toBeVisible();

    await page.mouse.down();
    await page.mouse.move(frame.x + frame.width / 2 - 80, frame.y + 10, {
      steps: 4,
    });
    await page.mouse.up();
    expect((await box(page, "mermaid-canvas")).x).toBeLessThan(zoomed.x);

    await page.getByTestId("mermaid-zoom-reset").click();
    expect((await box(page, "mermaid-canvas")).width).toBeCloseTo(before.width);
    await expect(page.getByTestId("mermaid-zoom-reset")).toBeHidden();
  });

  test("opens a diagram over the whole window", async ({ page }) => {
    await openDiagram(page, "# Diagram");

    await page.getByTestId("mermaid-full-screen").click();
    const viewer = page.getByTestId("mermaid-viewer");
    await expect(viewer).toBeVisible();
    // Polled, since the viewer grows into place as it opens.
    await expect
      .poll(() => box(page, "mermaid-viewer"))
      .toEqual({ x: 0, y: 0, width: 1600, height: 900 });

    const level = page.getByTestId("mermaid-viewer-zoom-level");
    const opening = Number.parseInt((await level.textContent()) ?? "", 10);
    const stage = await box(page, "mermaid-viewer-stage");
    await page.mouse.move(
      stage.x + stage.width / 2,
      stage.y + stage.height / 2,
    );
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, -300);
    await page.keyboard.up("Shift");
    await expect
      .poll(async () => Number.parseInt((await level.textContent()) ?? "", 10))
      .toBeGreaterThan(opening);

    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect(page.getByTestId("mermaid-full-screen")).toBeFocused();
  });
});
