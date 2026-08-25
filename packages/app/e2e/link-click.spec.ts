import { expect, test } from "@playwright/test";
import {
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  removeMarkdownProject,
  richTextEditor,
  writeProjectFile,
} from "./helpers";

test.describe("clicking links in the rich-text editor", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("link-click");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("plain click on an external link opens it in a new tab @smoke", async ({
    context,
    page,
  }) => {
    // Keep any opened popup off the real network.
    await context.route("https://example.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<h1>example.com stub</h1>",
      }),
    );

    const filePath = writeProjectFile(
      projectDir,
      "links.md",
      [
        "# Link fixture",
        "",
        "See the [Example](https://example.com/docs) docs.",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);

    const link = richTextEditor(page).locator(
      'a[href="https://example.com/docs"]',
    );
    await expect(link).toBeVisible();

    const popupPromise = page
      .waitForEvent("popup", { timeout: 5_000 })
      .catch(() => null);
    await link.click();
    const popup = await popupPromise;

    const popoverAppeared = await page
      .getByTestId("link-url-input")
      .isVisible()
      .catch(() => false);

    logE2eEvent("link-click.external", {
      popupOpened: popup !== null,
      popoverAppeared,
    });

    expect(
      popup,
      `expected a plain left click on the external link to open it (window.open popup), but no popup appeared. Link edit popover shown instead: ${popoverAppeared}`,
    ).not.toBeNull();
    expect(popup?.url()).toContain("https://example.com/docs");
  });

  test("plain click on a relative markdown link navigates this window to that document @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "index.md",
      ["# Index", "", "Read [Other](other.md) next.", ""].join("\n"),
    );
    writeProjectFile(projectDir, "other.md", "# Other\n\nOther body.\n");

    await openMarkdownFile(page, filePath);

    const link = richTextEditor(page).locator(
      'a[data-markdown-src="other.md"]',
    );
    await expect(link).toBeVisible();
    await link.click();

    const popoverAppeared = await page
      .getByTestId("link-url-input")
      .isVisible()
      .catch(() => false);

    logE2eEvent("link-click.relative", {
      popoverAppeared,
    });

    await expect
      .poll(
        () => {
          const url = new URL(page.url());
          return url.searchParams.get("path") ?? "";
        },
        {
          timeout: 5_000,
          message: `expected clicking the relative link to navigate this window to other.md, but the location did not change. Link edit popover shown instead: ${popoverAppeared}`,
        },
      )
      .toMatch(/other\.md$/);
  });
});
