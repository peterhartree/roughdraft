import fs from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  appendInCodeEditor,
  codeEditor,
  createMarkdownProject,
  documentSaveStatus,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  richTextEditor,
  writeProjectFile,
} from "./helpers";

const TARGET_PARAGRAPH = 70;
const TARGET_TEXT = `Paragraph ${TARGET_PARAGRAPH}: stable target text for refresh mapping.`;
const TARGET_CARET_MARKER = `Paragraph ${TARGET_PARAGRAPH}:`;

function longMarkdown() {
  return [
    "# External refresh regression",
    "",
    ...Array.from(
      { length: 140 },
      (_, index) =>
        `Paragraph ${index + 1}: stable target text for refresh mapping.`,
    ),
    "",
  ].join("\n\n");
}

function insertBefore(content: string, paragraph: number, insertion: string) {
  const marker = `Paragraph ${paragraph}:`;
  const index = content.indexOf(marker);
  if (index < 0) throw new Error(`Could not find ${marker}`);
  return `${content.slice(0, index)}${insertion}\n\n${content.slice(index)}`;
}

function replaceParagraph(
  content: string,
  paragraph: number,
  replacement: string,
) {
  const marker = `Paragraph ${paragraph}: stable target text for refresh mapping.`;
  if (!content.includes(marker)) throw new Error(`Could not find ${marker}`);
  return content.replace(marker, replacement);
}

async function placeCaretInTarget(page: Page) {
  const target = richTextEditor(page)
    .locator("p") // selector-check-ignore -- generated Markdown paragraphs are the caret-mapping contract
    .filter({ hasText: TARGET_TEXT })
    .first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  if (!box) throw new Error("Expected target paragraph bounds");
  await target.click({
    position: {
      x: Math.max(1, box.width - 2),
      y: Math.max(1, box.height - 2),
    },
  });
}

async function markEditorInstance(page: Page) {
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".ProseMirror");
    if (!editor) throw new Error("Expected a rich-text editor");
    (
      window as Window & { __documentRefreshEditor?: HTMLElement }
    ).__documentRefreshEditor = editor;
  });
}

async function editorPosition(page: Page) {
  return page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>(
      '[data-testid="document-workspace-scroll"]',
    );
    const editor = document.querySelector<HTMLElement>(".ProseMirror");
    const selection = window.getSelection();
    const marker = (
      window as Window & { __documentRefreshEditor?: HTMLElement }
    ).__documentRefreshEditor;
    const target = [
      ...(editor?.querySelectorAll("p") ?? []), // selector-check-ignore -- generated Markdown paragraphs are the viewport anchor contract
    ].find((node) => node.textContent?.includes("Paragraph 70:"));

    if (!workspace || !editor) {
      throw new Error(
        "Expected an active editor and workspace scroll container",
      );
    }

    let cursorText = "";
    if (selection?.anchorNode && editor.contains(selection.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      cursorText = range.toString().slice(-180);
    }

    return {
      activeElement: document.activeElement?.className ?? "",
      cursorText,
      sameEditor: marker === editor,
      scrollTop: workspace.scrollTop,
      targetTop: target?.getBoundingClientRect().top ?? null,
    };
  });
}

async function openFind(page: Page) {
  await page.getByTestId("document-workspace-scroll").dispatchEvent("keydown", {
    key: "f",
    code: "KeyF",
    metaKey: process.platform === "darwin",
    ctrlKey: process.platform !== "darwin",
    shiftKey: false,
    bubbles: true,
    cancelable: true,
  });
}

async function settleLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

test.describe("external document refresh", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("document-refresh");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("maps an insertion above the caret while preserving the viewport", async ({
    page,
  }) => {
    const filePath = writeProjectFile(projectDir, "refresh.md", longMarkdown());
    await openMarkdownFile(page, filePath, "rich-text");
    await placeCaretInTarget(page);
    await markEditorInstance(page);
    await settleLayout(page);

    const before = await editorPosition(page);
    expect(before.scrollTop).toBeGreaterThan(100);
    expect(before.cursorText).toContain(TARGET_CARET_MARKER);

    const insertion = "External insertion above the current caret.";
    fs.writeFileSync(
      filePath,
      insertBefore(longMarkdown(), TARGET_PARAGRAPH, insertion),
    );
    await expect(richTextEditor(page)).toContainText(insertion);
    await settleLayout(page);

    const after = await editorPosition(page);
    expect(after.sameEditor).toBe(true);
    expect(after.activeElement).toContain("ProseMirror");
    expect(after.cursorText).toContain(TARGET_CARET_MARKER);
    expect(after.scrollTop).toBeGreaterThan(100);
    expect(after.targetTop).not.toBeNull();
    const firstViewportDelta = Math.abs(
      (after.targetTop ?? 0) - (before.targetTop ?? 0),
    );
    expect(firstViewportDelta).toBeLessThanOrEqual(2);
  });

  test("keeps the same caret through multiple disjoint edits in one external update", async ({
    page,
  }) => {
    const initial = longMarkdown();
    const filePath = writeProjectFile(
      projectDir,
      "multiple-refresh.md",
      initial,
    );
    await openMarkdownFile(page, filePath, "rich-text");
    await placeCaretInTarget(page);
    await markEditorInstance(page);
    await settleLayout(page);
    const before = await editorPosition(page);

    const firstInsertion = "First external insertion above the caret.";
    const afterFirst = insertBefore(initial, TARGET_PARAGRAPH, firstInsertion);
    const secondEdit =
      "Paragraph 120: stable target text for refresh mapping. External edit below the caret.";
    const combinedExternalUpdate = replaceParagraph(
      afterFirst,
      120,
      secondEdit,
    );
    fs.writeFileSync(filePath, combinedExternalUpdate);
    await expect(richTextEditor(page)).toContainText(firstInsertion);
    await expect(richTextEditor(page)).toContainText(
      "External edit below the caret.",
    );
    await settleLayout(page);

    const after = await editorPosition(page);
    expect(after.sameEditor).toBe(true);
    expect(after.activeElement).toContain("ProseMirror");
    expect(after.cursorText).toContain(TARGET_CARET_MARKER);
    expect(after.scrollTop).toBeGreaterThan(100);
    expect(after.targetTop).not.toBeNull();
    const combinedViewportDelta = Math.abs(
      (after.targetTop ?? 0) - (before.targetTop ?? 0),
    );
    expect(combinedViewportDelta).toBeLessThanOrEqual(2);
  });

  test("preserves undo history after a saved edit and external insertion", async ({
    page,
  }) => {
    const initial = longMarkdown();
    const filePath = writeProjectFile(projectDir, "undo-refresh.md", initial);
    await openMarkdownFile(page, filePath, "rich-text");
    await placeCaretInTarget(page);

    const localMarker = " LOCAL SAVED";
    await page.keyboard.type(localMarker);
    await expect
      .poll(() => fs.readFileSync(filePath, "utf8"))
      .toContain(localMarker);
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      "Saved",
    );

    const insertion = "External insertion before the saved edit.";
    const savedLocalDocument = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(
      filePath,
      insertBefore(savedLocalDocument, TARGET_PARAGRAPH, insertion),
    );
    await expect(richTextEditor(page)).toContainText(insertion);

    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+z" : "Control+z",
    );
    await expect(richTextEditor(page)).not.toContainText(localMarker);
    await expect(richTextEditor(page)).toContainText(insertion);
  });

  test("does not steal Find focus during an external refresh", async ({
    page,
  }) => {
    const initial = longMarkdown();
    const filePath = writeProjectFile(projectDir, "find-refresh.md", initial);
    await openMarkdownFile(page, filePath, "rich-text");
    await openFind(page);

    const findInput = page.getByTestId("document-find-input");
    await expect(findInput).toBeFocused();
    await findInput.fill("Paragraph 70");
    await expect(page.getByTestId("document-find-count")).toContainText("of 1");

    const externalMarker = "External refresh while Find is open: Paragraph 70.";
    fs.writeFileSync(filePath, `${initial}\n\n${externalMarker}\n`);
    await expect(richTextEditor(page)).toContainText(externalMarker);

    await expect(findInput).toBeFocused();
    await expect(findInput).toHaveValue("Paragraph 70");
    await expect(page.getByTestId("document-find-count")).toContainText("of 2");
    await expect(page.getByTestId("document-find-bar")).toBeVisible();
  });

  test("keeps an unsaved rich-text draft when the disk file changes", async ({
    page,
  }) => {
    await page.route("**/api/markdown-file/events**", (route) => route.abort());

    const initial = longMarkdown();
    const filePath = writeProjectFile(
      projectDir,
      "conflict-refresh.md",
      initial,
    );
    await openMarkdownFile(page, filePath, "rich-text");
    await placeCaretInTarget(page);

    const localMarker = " LOCAL DRAFT";
    await page.keyboard.type(localMarker);
    const external = `${initial}\n\nExternal content from another writer.\n`;
    fs.writeFileSync(filePath, external);

    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      "Save conflict",
    );
    await expect(richTextEditor(page)).toContainText(localMarker);
    expect(fs.readFileSync(filePath, "utf8")).toBe(external);
  });

  test("flushes resumed typing across delayed PUT and watcher GET responses", async ({
    page,
  }) => {
    let putCount = 0;
    let activePuts = 0;
    let maxConcurrentPuts = 0;
    let firstRequestReady!: () => void;
    const firstRequest = new Promise<void>((resolve) => {
      firstRequestReady = resolve;
    });
    let releaseFirstResponse!: () => void;
    const firstResponse = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve;
    });
    let documentGetCount = 0;
    let delayedGetReady!: () => void;
    const delayedGetRequest = new Promise<void>((resolve) => {
      delayedGetReady = resolve;
    });
    let releaseDelayedGet!: () => void;
    const delayedGetResponse = new Promise<void>((resolve) => {
      releaseDelayedGet = resolve;
    });

    const filePath = writeProjectFile(
      projectDir,
      "delayed-save.md",
      longMarkdown(),
    );
    await openMarkdownFile(page, filePath, "rich-text");
    await placeCaretInTarget(page);

    await page.route("**/api/markdown-file**", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (
        route.request().method() === "GET" &&
        requestUrl.pathname === "/api/markdown-file"
      ) {
        const response = await route.fetch();
        documentGetCount += 1;
        if (documentGetCount === 1) {
          delayedGetReady();
          await delayedGetResponse;
        }
        await route.fulfill({ response });
        return;
      }
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }

      const requestNumber = ++putCount;
      activePuts += 1;
      maxConcurrentPuts = Math.max(maxConcurrentPuts, activePuts);
      try {
        const response = await route.fetch();
        if (requestNumber === 1) {
          firstRequestReady();
          await firstResponse;
        }
        await route.fulfill({ response });
      } finally {
        activePuts -= 1;
      }
    });

    await page.keyboard.type(" FIRST");

    await firstRequest;
    await expect(richTextEditor(page)).toContainText("FIRST");
    releaseFirstResponse();
    await delayedGetRequest;
    await page.keyboard.type(" SECOND");
    releaseDelayedGet();

    await expect(richTextEditor(page)).toContainText("FIRST SECOND");
    await expect
      .poll(() => fs.readFileSync(filePath, "utf8"), { timeout: 10_000 })
      .toContain("FIRST SECOND");
    expect(maxConcurrentPuts).toBe(1);
  });

  test("serialises delayed overwrite with typing made while it is pending", async ({
    page,
  }) => {
    await page.route("**/api/markdown-file/events**", (route) => route.abort());

    let activePuts = 0;
    let maxConcurrentPuts = 0;
    let overwriteRequestReady!: () => void;
    const overwriteRequest = new Promise<void>((resolve) => {
      overwriteRequestReady = resolve;
    });
    let releaseOverwrite!: () => void;
    const overwriteResponse = new Promise<void>((resolve) => {
      releaseOverwrite = resolve;
    });

    await page.route("**/api/markdown-file**", async (route) => {
      if (route.request().url().includes("/api/markdown-file/events")) {
        await route.abort();
        return;
      }
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }

      activePuts += 1;
      maxConcurrentPuts = Math.max(maxConcurrentPuts, activePuts);
      try {
        const payload = route.request().postDataJSON() as {
          expectedVersion?: unknown;
        };
        if (typeof payload.expectedVersion === "string") {
          await route.continue();
          return;
        }

        const response = await route.fetch();
        overwriteRequestReady();
        await overwriteResponse;
        await route.fulfill({ response });
      } finally {
        activePuts -= 1;
      }
    });

    const filePath = writeProjectFile(
      projectDir,
      "delayed-overwrite.md",
      "# Conflict\n\nOriginal body.\n",
    );
    await openMarkdownFile(page, filePath, "code");
    await expect(codeEditor(page)).toContainText("Original body.");

    fs.writeFileSync(filePath, "# Conflict\n\nExternal body.\n");
    await appendInCodeEditor(page, "\nDraft A before overwrite.\n");
    await expect(
      page.getByTestId("file-conflict-action-overwrite"),
    ).toBeVisible();

    const overwriteClick = page
      .getByTestId("file-conflict-action-overwrite")
      .click();
    await overwriteRequest;

    await appendInCodeEditor(page, "Draft B while overwrite is pending.\n");
    await expect(
      page.getByTestId("file-conflict-action-overwrite"),
    ).toBeDisabled();
    await expect(
      page.getByTestId("file-conflict-action-reload"),
    ).toBeDisabled();
    await expect(
      page.getByTestId("file-conflict-action-keep-editing"),
    ).toBeDisabled();

    releaseOverwrite();
    await overwriteClick;

    await expect
      .poll(() => readProjectFile(projectDir, "delayed-overwrite.md"), {
        timeout: 10_000,
      })
      .toContain("Draft B while overwrite is pending.");
    expect(maxConcurrentPuts).toBe(1);
  });
});
