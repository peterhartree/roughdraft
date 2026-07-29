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
