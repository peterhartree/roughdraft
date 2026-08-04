import { expect, type Page, test } from "@playwright/test";
import {
  createMarkdownProject,
  openMarkdownFile,
  removeMarkdownProject,
  writeProjectFile,
} from "./helpers";

// Reproduces: navigating document find results with Cmd+G updates the match
// count and highlight, but does not scroll the viewport to reveal an active
// match that is off-screen.

const FILLER_PARAGRAPHS = 200;

function longDocument() {
  return [
    "# Top needle",
    "",
    ...Array.from({ length: FILLER_PARAGRAPHS }, (_, i) => [
      `Filler paragraph ${i + 1} with enough words to occupy a full line of text.`,
      "",
    ]).flat(),
    "The bottom needle is here.",
    "",
  ].join("\n");
}

async function dispatchFindShortcut(page: Page, key: "f" | "g") {
  await page.getByTestId("document-workspace-scroll").dispatchEvent("keydown", {
    key,
    code: `Key${key.toUpperCase()}`,
    metaKey: process.platform === "darwin",
    ctrlKey: process.platform !== "darwin",
    bubbles: true,
    cancelable: true,
  });
}

// Returns geometry of the active match relative to the workspace scroll
// container's visible viewport, evaluated in the page so off-screen and
// unrendered (virtualized) matches are both observable.
function activeMatchViewportState(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector(
      '[data-testid="document-workspace-scroll"]',
    );
    if (!scroller) return { error: "scroller missing" };
    const scrollerRect = scroller.getBoundingClientRect();
    const match = document.querySelector(
      '[data-testid="document-find-match-active"]',
    );
    const matchRect = match?.getBoundingClientRect() ?? null;
    return {
      scrollTop: Math.round(scroller.scrollTop),
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      viewportTop: Math.round(scrollerRect.top),
      viewportBottom: Math.round(scrollerRect.bottom),
      matchRendered: match !== null,
      matchTop: matchRect ? Math.round(matchRect.top) : null,
      matchBottom: matchRect ? Math.round(matchRect.bottom) : null,
      activeMatchInView:
        matchRect !== null &&
        matchRect.height > 0 &&
        matchRect.top >= scrollerRect.top &&
        matchRect.bottom <= scrollerRect.bottom,
    };
  });
}

test.describe("document find scrolls the active match into view", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("find-scroll");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  for (const view of ["rich-text", "code"] as const) {
    test(`${view} view scrolls to an off-screen match on Cmd+G`, async ({
      page,
    }) => {
      const filePath = writeProjectFile(
        projectDir,
        "long-find.md",
        longDocument(),
      );
      await openMarkdownFile(page, filePath, view);
      const editorTestId =
        view === "rich-text" ? "rich-text-editor" : "markdown-code-editor";
      await expect(page.getByTestId(editorTestId)).toBeVisible();

      await dispatchFindShortcut(page, "f");
      const findInput = page.getByTestId("document-find-input");
      await expect(findInput).toBeFocused();
      await findInput.fill("needle");
      await expect(page.getByTestId("document-find-count")).toHaveText(
        "1 of 2",
      );

      // Sanity: the first match is at the top of the document and visible.
      await expect
        .poll(
          async () => (await activeMatchViewportState(page)).activeMatchInView,
        )
        .toBe(true);

      // Navigate to the second match, which sits below hundreds of filler
      // paragraphs and is off-screen.
      await dispatchFindShortcut(page, "g");
      await expect(page.getByTestId("document-find-count")).toHaveText(
        "2 of 2",
      );

      // The active match must be brought into the scroll container's visible
      // viewport. Poll so a slightly async scroll cannot cause a false fail;
      // the serialized state in the failure output shows scrollTop and the
      // match/viewport geometry.
      await expect
        .poll(
          async () => JSON.stringify(await activeMatchViewportState(page)),
          {
            timeout: 4_000,
          },
        )
        .toContain('"activeMatchInView":true');
    });
  }
});
