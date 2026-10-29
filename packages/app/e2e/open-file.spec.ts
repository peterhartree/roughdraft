import { expect, test } from "@playwright/test";
import {
  captureResponsiveScreenshots,
  codeEditor,
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  removeMarkdownProject,
  writeProjectFile,
} from "./helpers";

test.describe("opening local markdown files", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("open-file");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("renders core Markdown blocks from a real file @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "review.md",
      [
        "# Smoke Fixture",
        "",
        "A paragraph with [local link](./notes.md), [anchor](#smoke-fixture), and [mail](mailto:review@example.com).",
        "",
        "- first",
        "- second",
        "",
        "- [x] shipped",
        "- [ ] pending",
        "",
        "| Name | Status |",
        "| --- | --- |",
        "| Roughdraft | ready |",
        "",
        '![Sketch](./images/sketch.png "Sketch title")',
        "",
        "```ts",
        "const value = 1;",
        "```",
        "",
      ].join("\n"),
    );
    writeProjectFile(
      projectDir,
      "images/sketch.png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
    );

    await openMarkdownFile(page, filePath);

    const editor = page.getByTestId("rich-text-editor");
    await expect(editor).toContainText("Smoke Fixture");
    await expect(editor).toContainText("first");
    await expect(editor).toContainText("Roughdraft");
    await expect(
      editor.locator('a[data-markdown-src="./notes.md"]', {
        hasText: "local link",
      }),
    ).toBeVisible();
    await expect(
      editor.locator(
        'img[alt="Sketch"][data-markdown-src="./images/sketch.png"]',
      ),
    ).toBeVisible();
    await expect(editor).toContainText("const value = 1;");

    logE2eEvent("open-file.rendered", {
      projectDir,
      file: "review.md",
    });
  });

  test("finds repeated text and navigates results in both editor views @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "find.md",
      [
        "# Needle one",
        "",
        "A paragraph with needle two.",
        "",
        "The final needle is here.",
        "",
      ].join("\n"),
    );
    const dispatchFindShortcut = async (key: "f" | "g", shiftKey = false) => {
      await page
        .getByTestId("document-workspace-scroll")
        .dispatchEvent("keydown", {
          key,
          code: `Key${key.toUpperCase()}`,
          metaKey: process.platform === "darwin",
          ctrlKey: process.platform !== "darwin",
          shiftKey,
          bubbles: true,
          cancelable: true,
        });
    };

    await openMarkdownFile(page, filePath);
    await expect(page.getByTestId("rich-text-editor")).toBeVisible();
    await dispatchFindShortcut("f");

    const findInput = page.getByTestId("document-find-input");
    const findCount = page.getByTestId("document-find-count");
    await expect(findInput).toBeFocused();
    await findInput.fill("needle");
    await expect(findCount).toHaveText("1 of 3");
    await expect(page.getByTestId("document-find-match-active")).toHaveCount(1);
    await expect(page.getByTestId("document-find-match")).toHaveCount(2);

    await dispatchFindShortcut("g");
    await expect(findCount).toHaveText("2 of 3");
    await dispatchFindShortcut("g", true);
    await expect(findCount).toHaveText("1 of 3");

    const richTextContent = page
      .getByTestId("rich-text-editor")
      .locator(".ProseMirror");
    await richTextContent.click();
    await expect(findInput).not.toBeFocused();
    await dispatchFindShortcut("f");
    await expect(findInput).toBeFocused();

    await richTextContent.click();
    await richTextContent.press("ControlOrMeta+End");
    await richTextContent.pressSequentially(" needle");
    await expect(findCount).toHaveText("1 of 4");

    await page.getByTestId("document-editor-view-toggle").click();
    await expect(page.getByTestId("markdown-code-editor")).toBeVisible();
    await expect(findCount).toHaveText("1 of 4");
    await dispatchFindShortcut("g");
    await expect(findCount).toHaveText("2 of 4");

    const codeContent = page
      .getByTestId("markdown-code-editor")
      .locator(".cm-content");
    await codeContent.click();
    await codeContent.press("ControlOrMeta+End");
    await codeContent.pressSequentially("\nneedle");
    await expect(findCount).toHaveText("2 of 5");

    await findInput.press("Escape");
    await expect(page.getByTestId("document-find-bar")).toBeHidden();
    await expect(page.getByTestId("document-find-match-active")).toHaveCount(0);

    logE2eEvent("open-file.document-find", {
      projectDir,
      file: "find.md",
      matches: 5,
    });
  });

  test("renders tables whose cells contain code spans with pipes", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "piped-code-table.md",
      [
        "# Piped code table",
        "",
        "| Command | Purpose |",
        "| --- | --- |",
        "| `gh api | base64 -d` | Decode the response |",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);

    const editor = page.getByTestId("rich-text-editor");
    await expect(editor).toContainText("Piped code table");
    // The table content must remain visible, not collapse into an empty
    // raw-markdown placeholder div.
    await expect(editor).toContainText("Decode the response");
    await expect(editor.locator("table")).toBeVisible(); // selector-check-ignore -- the rendered table element is the contract

    logE2eEvent("open-file.piped-code-table", {
      projectDir,
      file: "piped-code-table.md",
    });
  });

  test("keeps prose readable while wide tables use the available viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const filePath = writeProjectFile(
      projectDir,
      "wide-table.md",
      [
        "# Wide table review",
        "",
        "This paragraph should keep a readable line length even when the window is wide enough to give data-heavy content substantially more room.",
        "",
        "| Location | Before | After | Rationale | Verification |",
        "| --- | --- | --- | --- | --- |",
        "| SubscribeForm.tsx:69-77 | Fixed overlay | Shared dialog primitive | Consistent keyboard behaviour | Focus enters and returns |",
        "| SummaryPeekSheet.tsx:222-245 | Narrow sheet | Responsive sheet | More room for episode context | Desktop and compact viewport |",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);

    const editor = page.getByTestId("rich-text-editor");
    const prose = editor.locator("p").first(); // selector-check-ignore -- rendered paragraph geometry is the contract
    const tableViewport = editor.locator(".tableWrapper"); // selector-check-ignore -- Tiptap's table scroll viewport is the product boundary
    const workspace = page.getByTestId("document-workspace-scroll");
    const contentCard = page.getByTestId("document-content-card");

    await expect(prose).toBeVisible();
    await expect(tableViewport).toBeVisible();

    const proseBox = await prose.boundingBox();
    const tableBox = await tableViewport.boundingBox();
    const workspaceBox = await workspace.boundingBox();

    expect(proseBox).not.toBeNull();
    expect(tableBox).not.toBeNull();
    expect(workspaceBox).not.toBeNull();
    logE2eEvent("open-file.wide-table-layout", {
      proseWidth: proseBox?.width ?? null,
      tableWidth: tableBox?.width ?? null,
      workspaceWidth: workspaceBox?.width ?? null,
    });
    expect(proseBox?.width).toBeLessThanOrEqual(760);
    expect(tableBox?.width).toBeGreaterThan((workspaceBox?.width ?? 0) * 0.75);
    expect(tableBox?.width).toBeGreaterThan((proseBox?.width ?? 0) * 1.4);
    await expect(contentCard).toHaveCSS("border-top-width", "0px");
    await expect(contentCard).toHaveCSS("border-radius", "0px");
    await expect(contentCard).toHaveCSS("box-shadow", "none");

    await captureResponsiveScreenshots(page, {
      desktop: "wide-table-desktop.png",
      mobile: "wide-table-mobile.png",
    });

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.getByTestId("document-editor-view-toggle").click();
    const codeCard = page.getByTestId("document-content-card");
    await expect(page.getByTestId("markdown-code-editor")).toBeVisible();

    const codeCardBox = await codeCard.boundingBox();
    const codeWorkspaceBox = await workspace.boundingBox();
    expect(codeCardBox).not.toBeNull();
    expect(codeWorkspaceBox).not.toBeNull();
    expect(codeCardBox?.width).toBeLessThanOrEqual(744);
    expect(
      Math.abs(
        (codeCardBox?.x ?? 0) +
          (codeCardBox?.width ?? 0) / 2 -
          ((codeWorkspaceBox?.x ?? 0) + (codeWorkspaceBox?.width ?? 0) / 2),
      ),
    ).toBeLessThanOrEqual(1);
  });

  test("lets tables inside callouts use the wide-table width while their prose stays readable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const filePath = writeProjectFile(
      projectDir,
      "callout-table.md",
      [
        "# Callout table review",
        "",
        "This paragraph sets the readable text column that wide tables break out from on a wide window.",
        "",
        "> [!IMPORTANT]",
        "> This callout paragraph should keep a readable line length even though the decision table below it uses the full width of the window.",
        ">",
        "> | # | Element | Options | Recommendation | Why |",
        "> | --- | --- | --- | --- | --- |",
        "> | 1 | How an option looks | 1A text link, 1B pencil icon | **1A** | Edit is findable but quiet, and only shows on the chosen option. |",
        "> | 2 | Editing and saving | 2A Done and Cancel, 2B saved as you type | **2A** | It answers how to save with the most familiar pattern. |",
        "",
        "> A plain quotation with a table also gets the room it needs.",
        ">",
        "> | Location | Before | After | Rationale | Verification |",
        "> | --- | --- | --- | --- | --- |",
        "> | SubscribeForm.tsx:69-77 | Fixed overlay | Shared dialog primitive | Consistent keyboard behaviour | Focus enters and returns |",
        "",
        "> [!NOTE]",
        "> A callout without a table stays in the text column, however long its paragraph happens to be on a wide window.",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);

    const editor = page.getByTestId("rich-text-editor");
    const workspace = page.getByTestId("document-workspace-scroll");
    const prose = editor.locator("p").first(); // selector-check-ignore -- rendered block geometry is the contract
    const quotes = editor.locator("blockquote"); // selector-check-ignore -- rendered block geometry is the contract
    await expect(quotes).toHaveCount(3);
    const [alertWithTable, quoteWithTable, alertWithoutTable] = [
      quotes.nth(0),
      quotes.nth(1),
      quotes.nth(2),
    ];
    const alertTable = alertWithTable.locator(".tableWrapper"); // selector-check-ignore -- Tiptap's table scroll viewport is the product boundary
    const quoteTable = quoteWithTable.locator(".tableWrapper"); // selector-check-ignore -- Tiptap's table scroll viewport is the product boundary
    const alertProse = alertWithTable.locator(":scope > p").first(); // selector-check-ignore -- rendered paragraph geometry is the contract
    await expect(alertTable).toBeVisible();
    await expect(quoteTable).toBeVisible();

    const box = async (locator: typeof prose) => {
      const result = await locator.boundingBox();
      if (!result) throw new Error("missing geometry");
      return result;
    };
    const proseBox = await box(prose);
    const workspaceBox = await box(workspace);
    const alertTableBox = await box(alertTable);
    const quoteTableBox = await box(quoteTable);
    const alertProseBox = await box(alertProse);
    const plainAlertBox = await box(alertWithoutTable);
    logE2eEvent("open-file.callout-table-layout", {
      proseWidth: proseBox.width,
      workspaceWidth: workspaceBox.width,
      alertTableWidth: alertTableBox.width,
      quoteTableWidth: quoteTableBox.width,
      alertProseWidth: alertProseBox.width,
      plainAlertWidth: plainAlertBox.width,
    });

    for (const tableBox of [alertTableBox, quoteTableBox]) {
      expect(tableBox.width).toBeGreaterThan(workspaceBox.width * 0.75);
      expect(tableBox.width).toBeGreaterThan(proseBox.width * 1.4);
    }
    expect(alertProseBox.width).toBeLessThanOrEqual(760);
    expect(plainAlertBox.width).toBeLessThanOrEqual(proseBox.width);
    expect(plainAlertBox.x).toBeCloseTo(proseBox.x, 0);
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`sets quotations and callouts in the body text colour (${colorScheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      const filePath = writeProjectFile(
        projectDir,
        "quote-colour.md",
        [
          "Body paragraph.",
          "",
          "> A plain quotation.",
          "",
          "> [!NOTE]",
          "> A callout.",
          "",
        ].join("\n"),
      );
      await openMarkdownFile(page, filePath);
      const editor = page.getByTestId("rich-text-editor");
      const colourOf = (text: string) =>
        editor
          .getByText(text)
          .evaluate((element) => getComputedStyle(element).color);
      const body = await colourOf("Body paragraph.");
      expect(await colourOf("A plain quotation.")).toBe(body);
      expect(await colourOf("A callout.")).toBe(body);
    });
  }

  test("lets wide images break out of the text column without overflowing @smoke", async ({
    page,
  }) => {
    const svgOfWidth = (width: number) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="200"><rect width="100%" height="100%" fill="#94a3b8"/></svg>`;
    writeProjectFile(projectDir, "images/wide.svg", svgOfWidth(1800));
    writeProjectFile(projectDir, "images/small.svg", svgOfWidth(240));
    const body = [
      "This paragraph sets the readable text column that images break out from on a wide window.",
      "",
      "![Wide screenshot](./images/wide.svg)",
      "",
      "![Small icon](./images/small.svg)",
      "",
    ];
    const plainPath = writeProjectFile(
      projectDir,
      "breakout-images.md",
      ["# Breakout images", "", ...body].join("\n"),
    );
    const commentedPath = writeProjectFile(
      projectDir,
      "breakout-images-commented.md",
      [
        "# Breakout images",
        "",
        '{==This paragraph==}{>>Check the screenshot.<<}{id="c1" by="user" at="2026-04-23T18:00:00.000Z"} sets the readable text column.',
        "",
        ...body.slice(2),
      ].join("\n"),
    );

    const editor = page.getByTestId("rich-text-editor");
    const prose = editor.locator("p").first(); // selector-check-ignore -- rendered paragraph geometry is the contract
    const wideImage = editor.locator(
      'img[data-markdown-src="./images/wide.svg"]',
    );
    const smallImage = editor.locator(
      'img[data-markdown-src="./images/small.svg"]',
    );
    const workspace = page.getByTestId("document-workspace-scroll");

    const measure = async (label: string, breaksOut: boolean) => {
      await expect(wideImage).toBeVisible();
      await expect(smallImage).toBeVisible();
      await expect
        .poll(() =>
          wideImage.evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBe(1800);
      if (breaksOut) {
        // The breakout applies once the image has loaded and its natural
        // width is known.
        await expect
          .poll(async () => {
            const [imageBox, textBox] = await Promise.all([
              wideImage.boundingBox(),
              prose.boundingBox(),
            ]);
            return (imageBox?.width ?? 0) - (textBox?.width ?? 0);
          })
          .toBeGreaterThan(0);
      }
      const proseBox = await prose.boundingBox();
      const wideBox = await wideImage.boundingBox();
      const smallBox = await smallImage.boundingBox();
      const overflow = await workspace.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      );
      if (!proseBox || !wideBox || !smallBox) {
        throw new Error(`missing layout boxes for ${label}`);
      }
      logE2eEvent("open-file.breakout-image-layout", {
        label,
        proseWidth: proseBox.width,
        wideImageWidth: wideBox.width,
        smallImageWidth: smallBox.width,
        overflow,
      });
      return { proseBox, wideBox, smallBox, overflow };
    };
    const centre = (box: { x: number; width: number }) => box.x + box.width / 2;

    await page.setViewportSize({ width: 1600, height: 900 });
    await openMarkdownFile(page, plainPath);
    const wide = await measure("wide", true);
    expect(wide.wideBox.width).toBeCloseTo(wide.proseBox.width + 200, 0);
    expect(
      Math.abs(centre(wide.wideBox) - centre(wide.proseBox)),
    ).toBeLessThanOrEqual(1);
    expect(wide.smallBox.width).toBe(240);
    expect(wide.smallBox.x).toBeCloseTo(wide.proseBox.x, 0);
    expect(wide.overflow).toBe(0);

    await page.setViewportSize({ width: 1600, height: 900 });
    await openMarkdownFile(page, commentedPath);
    const rail = page.getByTestId("document-review-rail");
    await expect(rail).toContainText("Check the screenshot.");
    const withRail = await measure("wide-with-comments", true);
    const railBox = await rail.boundingBox();
    expect(withRail.wideBox.width).toBeGreaterThan(withRail.proseBox.width);
    expect(withRail.wideBox.x + withRail.wideBox.width).toBeLessThan(
      railBox?.x ?? 0,
    );
    expect(withRail.overflow).toBe(0);

    // Narrow enough that the text column fills the editor: no gutters remain.
    await page.setViewportSize({ width: 900, height: 900 });
    await openMarkdownFile(page, plainPath);
    const narrow = await measure("narrow", false);
    expect(narrow.wideBox.width).toBeCloseTo(narrow.proseBox.width, 0);
    expect(narrow.wideBox.x).toBeCloseTo(narrow.proseBox.x, 0);
    expect(narrow.overflow).toBe(0);
  });

  test("focuses an existing window for a repeated open request", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "repeat.md",
      "# Repeat Open\n\nExisting window body.\n",
    );

    await openMarkdownFile(page, filePath, "code");
    await expect(codeEditor(page)).toContainText("Existing window body.");

    const targetUrl = `/?${new URLSearchParams({
      path: filePath,
      editor: "code",
    }).toString()}`;
    const response = await page.request.post("/api/open-request", {
      data: { path: filePath, url: targetUrl },
    });

    expect(response.ok()).toBe(true);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      delivered: true,
    });
    await expect(codeEditor(page)).toContainText("Existing window body.");

    logE2eEvent("open-file.reused-existing-window", {
      projectDir,
      file: "repeat.md",
    });
  });
});
