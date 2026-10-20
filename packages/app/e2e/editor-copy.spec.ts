import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  removeMarkdownProject,
  richTextEditor,
  selectRichText,
  writeProjectFile,
} from "./helpers";

const plainCopyAction = "editor-context-menu-action-copy";
const markdownCopyAction = "editor-context-menu-action-copy-as-markdown";

async function captureMenuScreenshot(page: Page, name: string) {
  const screenshotDir = process.env.ROUGHDRAFT_SCREENSHOT_DIR;
  if (!screenshotDir) return;

  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, name) });
}

async function readClipboard(page: Page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe("rich-text editor context-menu copy actions", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("editor-copy");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("Copy puts selected formatted text on the clipboard as plain text", async ({
    context,
    page,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const filePath = writeProjectFile(
      projectDir,
      "copy.md",
      "# Copy\n\nThis has **formatted phrase** in the middle.\n",
    );

    await openMarkdownFile(page, filePath);
    const editor = richTextEditor(page);
    await selectRichText(page, "formatted phrase");
    const selectionTarget = editor.getByText("formatted phrase", {
      exact: true,
    });
    await selectionTarget.click({ button: "right" });

    const copy = page.getByTestId(plainCopyAction);
    await expect(copy).toBeVisible();
    await expect(copy).toBeEnabled();
    await captureMenuScreenshot(page, "selected-context-menu.png");
    await copy.click();

    const copiedText = await readClipboard(page);
    expect(copiedText).toBe("formatted phrase");
    logE2eEvent("editor-copy.plain-text", {
      action: "copy",
      characterCount: copiedText.length,
      passed: true,
    });
  });

  test("Copy as Markdown preserves formatting in a selected list", async ({
    context,
    page,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const filePath = writeProjectFile(
      projectDir,
      "copy-markdown.md",
      "# Copy\n\n- First **bold item**\n- Second *italic item*\n\nAfter the list.\n",
    );

    await openMarkdownFile(page, filePath);
    const editor = richTextEditor(page);
    await selectTextRange(page, "First", "italic item");
    await editor
      .getByText("First", { exact: false })
      .click({ button: "right" });

    const copyAsMarkdown = page.getByTestId(markdownCopyAction);
    await expect(copyAsMarkdown).toBeVisible();
    await expect(copyAsMarkdown).toBeEnabled();
    await captureMenuScreenshot(page, "selected-list-context-menu.png");
    await copyAsMarkdown.click();

    const copiedMarkdown = await readClipboard(page);
    expect(copiedMarkdown).toBe(
      "- First **bold item**\n- Second _italic item_",
    );
    logE2eEvent("editor-copy.markdown", {
      action: "copy-as-markdown",
      characterCount: copiedMarkdown.length,
      passed: true,
    });
  });

  test("copy actions remain available in Viewing mode", async ({
    context,
    page,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const filePath = writeProjectFile(
      projectDir,
      "copy-viewing.md",
      "# Copy\n\nThis has **formatted phrase** in the middle.\n",
    );

    await openMarkdownFile(page, filePath);
    await page.getByTestId("document-mode-trigger").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("document-mode-trigger")).toContainText(
      "Viewing",
    );

    const editor = richTextEditor(page);
    await selectRichText(page, "formatted phrase");
    await editor
      .getByText("formatted phrase", { exact: true })
      .click({ button: "right" });

    const copy = page.getByTestId(plainCopyAction);
    await expect(copy).toBeEnabled();
    await copy.click();
    const copiedText = await readClipboard(page);
    expect(copiedText).toBe("formatted phrase");
    logE2eEvent("editor-copy.viewing-mode", {
      action: "copy",
      characterCount: copiedText.length,
      passed: true,
    });
  });

  test("keeps the menu open and allows retry when clipboard writing fails", async ({
    context,
    page,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const filePath = writeProjectFile(
      projectDir,
      "copy-retry.md",
      "# Copy\n\nThis has **formatted phrase** in the middle.\n",
    );

    await openMarkdownFile(page, filePath);
    await page.evaluate(() => {
      const clipboard = navigator.clipboard;
      const originalWriteText = clipboard.writeText.bind(clipboard);
      let attempts = 0;
      Object.defineProperty(clipboard, "writeText", {
        configurable: true,
        value: async (text: string) => {
          attempts += 1;
          if (attempts === 1) {
            throw new DOMException(
              "Simulated clipboard failure",
              "NotAllowedError",
            );
          }
          return originalWriteText(text);
        },
      });
    });

    const editor = richTextEditor(page);
    await selectRichText(page, "formatted phrase");
    await editor
      .getByText("formatted phrase", { exact: true })
      .click({ button: "right" });

    const menu = page.getByTestId("editor-context-menu");
    const copy = page.getByTestId(plainCopyAction);
    await copy.click();
    await expect(page.getByTestId("editor-context-menu-copy-error")).toHaveText(
      "Could not copy. Try again.",
    );
    await expect(menu).toBeVisible();
    await expect(copy).toBeEnabled();

    await copy.click();
    const copiedText = await readClipboard(page);
    expect(copiedText).toBe("formatted phrase");
    logE2eEvent("editor-copy.retry", {
      action: "copy",
      characterCount: copiedText.length,
      writeAttempts: 2,
      passed: true,
    });
  });

  test("copy actions are disabled when no text is selected", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "copy-empty-selection.md",
      "# Copy\n\nThere is no selected text here.\n",
    );

    await openMarkdownFile(page, filePath);
    const editor = richTextEditor(page);
    const paragraph = editor.getByText("There is no selected text here.");
    await paragraph.click({ button: "right" });

    const copy = page.getByTestId(plainCopyAction);
    const copyAsMarkdown = page.getByTestId(markdownCopyAction);
    await expect(copy).toBeVisible();
    await expect(copyAsMarkdown).toBeVisible();
    await expect(copy).toBeDisabled();
    await expect(copyAsMarkdown).toBeDisabled();
    await captureMenuScreenshot(page, "empty-selection-context-menu.png");

    logE2eEvent("editor-copy.empty-selection", {
      copyDisabled: await copy.isDisabled(),
      copyAsMarkdownDisabled: await copyAsMarkdown.isDisabled(),
      passed: true,
    });
  });
});

async function selectTextRange(page: Page, startText: string, endText: string) {
  await richTextEditor(page).focus();
  await page.evaluate(
    ({ startText, endText }) => {
      const editor = document.querySelector(".ProseMirror");
      if (!editor) throw new Error("Could not find rich-text editor");

      const findTextNode = (text: string, fromEnd = false) => {
        const matches: Array<{ node: Text; index: number }> = [];
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const index = node.textContent?.indexOf(text) ?? -1;
          if (index >= 0) matches.push({ node: node as Text, index });
          node = walker.nextNode();
        }

        const match = fromEnd ? matches.at(-1) : matches[0];
        if (!match) throw new Error(`Could not find text "${text}"`);
        return match;
      };

      const start = findTextNode(startText);
      const end = findTextNode(endText, true);
      const range = document.createRange();
      range.setStart(start.node, start.index);
      range.setEnd(end.node, end.index + endText.length);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    },
    { startText, endText },
  );
}
