import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  createMarkdownProject,
  openMarkdownFile,
  removeMarkdownProject,
  writeProjectFile,
} from "./helpers";

const visualReviewDir = "/tmp/roughdraft-visual-review";

test.describe("sticky document header", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("sticky-header");
    fs.mkdirSync(visualReviewDir, { recursive: true });
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("stays visible without overflow across the review-rail breakpoint", async ({
    browser,
  }, testInfo) => {
    const body = Array.from(
      { length: 60 },
      (_, index) => `Paragraph ${index + 1}: review text for scrolling.`,
    ).join("\n\n");
    const filePath = writeProjectFile(
      projectDir,
      "sticky-review.md",
      [
        "# Sticky header review",
        "",
        "{==Review this sentence.==}{>>Keep the toolbar visible while scrolling.<<}{#c1}",
        "",
        body,
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: Reviewer",
        '    at: "2026-07-14T12:00:00.000Z"',
        "",
      ].join("\n"),
    );
    const baseURL = String(testInfo.project.use.baseURL);

    for (const viewport of [
      { width: 390, height: 640 },
      { width: 1099, height: 720 },
      { width: 1100, height: 720 },
      { width: 1280, height: 720 },
    ]) {
      const context = await browser.newContext({
        baseURL,
        colorScheme: "light",
        deviceScaleFactor: 2,
        viewport,
      });
      const page = await context.newPage();
      await openMarkdownFile(page, filePath, "rich-text");

      const header = page.getByTestId("document-page-header");
      await expect(header).toBeVisible();
      if (viewport.width >= 1100) {
        await expect(page.getByTestId("document-review-rail")).toBeVisible();
      } else {
        await expect(page.getByTestId("document-review-rail")).toBeHidden();
      }
      await page.screenshot({
        path: path.join(
          visualReviewDir,
          `sticky-${viewport.width}x${viewport.height}-top.png`,
        ),
      });

      const before = await header.evaluate((element) => {
        let scroller = element.parentElement;
        while (scroller) {
          const style = window.getComputedStyle(scroller);
          if (
            /(auto|scroll)/.test(style.overflowY) &&
            scroller.scrollHeight > scroller.clientHeight
          ) {
            break;
          }
          scroller = scroller.parentElement;
        }
        if (!scroller) throw new Error("Expected a document scroller");

        const scrollerBox = scroller.getBoundingClientRect();
        scroller.scrollTop = Math.min(900, scroller.scrollHeight);
        scroller.dispatchEvent(new Event("scroll"));
        return {
          scrollerTop: scrollerBox.top,
        };
      });

      await expect
        .poll(() =>
          header.evaluate((element) => {
            let scroller = element.parentElement;
            while (scroller) {
              const style = window.getComputedStyle(scroller);
              if (/(auto|scroll)/.test(style.overflowY)) break;
              scroller = scroller.parentElement;
            }
            if (!scroller) throw new Error("Expected a document scroller");

            const headerBox = element.getBoundingClientRect();
            const scrollerBox = scroller.getBoundingClientRect();
            return {
              headerTop: headerBox.top,
              horizontalOverflow: scroller.scrollWidth - scroller.clientWidth,
              scrollerTop: scrollerBox.top,
              scrollTop: scroller.scrollTop,
            };
          }),
        )
        .toMatchObject({
          headerTop: expect.closeTo(before.scrollerTop, 1),
          horizontalOverflow: expect.any(Number),
          scrollerTop: expect.closeTo(before.scrollerTop, 1),
          scrollTop: expect.any(Number),
        });

      const after = await header.evaluate((element) => {
        let scroller = element.parentElement;
        while (scroller) {
          const style = window.getComputedStyle(scroller);
          if (
            /(auto|scroll)/.test(style.overflowY) &&
            scroller.scrollHeight > scroller.clientHeight
          ) {
            break;
          }
          scroller = scroller.parentElement;
        }
        if (!scroller) throw new Error("Expected a document scroller");
        return {
          horizontalOverflow: scroller.scrollWidth - scroller.clientWidth,
          scrollTop: scroller.scrollTop,
        };
      });
      expect(after.scrollTop).toBeGreaterThan(0);
      expect(after.horizontalOverflow).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: path.join(
          visualReviewDir,
          `sticky-${viewport.width}x${viewport.height}-scrolled.png`,
        ),
      });
      await context.close();
    }
  });
});
