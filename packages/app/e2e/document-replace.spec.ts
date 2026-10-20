import { expect, type Page, test } from "@playwright/test";
import {
  codeEditor,
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  richTextEditor,
  writeProjectFile,
} from "./helpers";

async function openFind(page: Page) {
  await expect(
    page
      .getByTestId("rich-text-editor")
      .or(page.getByTestId("markdown-code-editor")),
  ).toBeVisible();
  await page.getByTestId("document-workspace-scroll").dispatchEvent("keydown", {
    key: "f",
    code: "KeyF",
    metaKey: process.platform === "darwin",
    ctrlKey: process.platform !== "darwin",
    bubbles: true,
    cancelable: true,
  });
  await expect(page.getByTestId("document-find-input")).toBeFocused();
}

async function openReplace(page: Page, query: string, replacement: string) {
  await openFind(page);
  await page.getByTestId("document-find-input").fill(query);
  await page.getByTestId("document-replace-toggle").click();
  await page.getByTestId("document-replace-input").fill(replacement);
}

async function setDocumentMode(
  page: Page,
  mode: "Editing" | "Suggesting" | "Viewing",
) {
  await page.getByTestId("document-mode-trigger").click();
  await page
    .getByRole("option", { name: mode, exact: true }) // selector-check-ignore -- mode options intentionally expose their stable accessible label
    .click();
  await expect(page.getByTestId("document-mode-trigger")).toContainText(mode);
}

async function undoInBrowser(page: Page) {
  const usesMeta = await page.evaluate(() =>
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform),
  );
  await page.keyboard.press(usesMeta ? "Meta+z" : "Control+z");
}

test.describe("find and replace", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("replace");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("offers replacement only while editing in both editor views", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "mode-gating.md",
      "# Mode gating\n\nNeedle.\n",
    );

    await openMarkdownFile(page, filePath, "rich-text");
    await openFind(page);
    await page.getByTestId("document-replace-toggle").click();

    const replacement = page.getByTestId("document-replace-input");
    const replace = page.getByTestId("document-replace-current");
    const replaceAll = page.getByTestId("document-replace-all");
    await expect(replacement).toBeEnabled();
    await page.getByTestId("document-find-input").fill("absent");
    await expect(replace).toBeDisabled();
    await expect(replaceAll).toBeDisabled();
    await page.getByTestId("document-find-input").fill("needle");
    await expect(replace).toBeEnabled();

    for (const mode of ["Suggesting", "Viewing"] as const) {
      await page.getByTestId("document-find-close").click();
      await setDocumentMode(page, mode);
      await openFind(page);
      await expect(replacement).toBeDisabled();
      await expect(replace).toBeDisabled();
      await expect(replaceAll).toBeDisabled();
    }

    await page.getByTestId("document-find-close").click();
    await setDocumentMode(page, "Editing");
    await openFind(page);
    await expect(replacement).toBeEnabled();
    await page.getByTestId("document-editor-view-toggle").click();
    await expect(codeEditor(page)).toBeVisible();
    await expect(replacement).toBeEnabled();
    logE2eEvent("document-replace.mode-gating", {
      editorViews: ["rich-text", "code"],
      reviewModes: ["suggesting", "viewing"],
    });
  });

  test("replaces the active rich-text match, advances, preserves marks, and saves", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "rich-replace.md",
      "# Rich replace\n\n**Needle** and _needle_ plus needle.\n",
    );

    await openMarkdownFile(page, filePath, "rich-text");
    await openReplace(page, "needle", "term");
    await expect(page.getByTestId("document-find-count")).toHaveText("1 of 3");

    logE2eEvent("document-replace.action", {
      action: "replace",
      editorView: "rich-text",
      match: 1,
    });
    await page.getByTestId("document-replace-current").click();
    await expect(page.getByTestId("document-find-count")).toHaveText("1 of 2");
    await expect(richTextEditor(page).locator("strong")).toHaveText("term"); // selector-check-ignore -- semantic formatting preservation is the behaviour under test

    await page.getByTestId("document-replace-current").click();
    await expect(page.getByTestId("document-find-count")).toHaveText("1 of 1");
    await expect(richTextEditor(page).locator("em")).toHaveText("term"); // selector-check-ignore -- semantic formatting preservation is the behaviour under test
    await expect(richTextEditor(page)).toContainText(
      "term and term plus needle.",
    );

    await expect
      .poll(() => readProjectFile(projectDir, "rich-replace.md"))
      .toBe("# Rich replace\n\n**term** and _term_ plus needle.\n");
    logE2eEvent("document-replace.persisted", {
      editorView: "rich-text",
      file: "rich-replace.md",
      remainingMatches: 1,
    });
  });

  test("a replacement containing the query advances to the next original match", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "advance-original.md",
      "# Advance\n\ncat cat cat\n",
    );

    await openMarkdownFile(page, filePath, "code");
    await openReplace(page, "cat", "cat!");
    const replace = page.getByTestId("document-replace-current");

    await replace.click();
    await expect(codeEditor(page)).toContainText("cat! cat cat");
    await expect(page.getByTestId("document-find-count")).toHaveText("2 of 3");
    await replace.click();
    await expect(codeEditor(page)).toContainText("cat! cat! cat");
    await expect(page.getByTestId("document-find-count")).toHaveText("3 of 3");

    await expect
      .poll(() => readProjectFile(projectDir, "advance-original.md"))
      .toBe("# Advance\n\ncat! cat! cat\n");
    logE2eEvent("document-replace.advances-past-replacement", {
      editorView: "code",
      file: "advance-original.md",
      persisted: true,
    });
  });

  test("an empty replacement deletes every match", async ({ page }) => {
    const filePath = writeProjectFile(
      projectDir,
      "delete-matches.md",
      "# Delete\n\nKeep red, red, and red.\n",
    );

    await openMarkdownFile(page, filePath, "rich-text");
    await openReplace(page, "red", "");
    await page.getByTestId("document-replace-all").click();

    await expect(richTextEditor(page)).toContainText("Keep , , and .");
    await expect(page.getByTestId("document-find-count")).toHaveText(
      "No results",
    );
    await expect
      .poll(() => readProjectFile(projectDir, "delete-matches.md"))
      .toBe("# Delete\n\nKeep , , and .\n");
    logE2eEvent("document-replace.empty-deletion", {
      editorView: "rich-text",
      file: "delete-matches.md",
      deletedMatches: 3,
    });
  });

  for (const editorView of ["rich-text", "code"] as const) {
    test(`${editorView} can replace a match typed after an initial no-results search`, async ({
      page,
    }) => {
      const filename = `late-match-${editorView}.md`;
      const filePath = writeProjectFile(
        projectDir,
        filename,
        "# Late match\n\nNothing here yet.\n",
      );

      await openMarkdownFile(page, filePath, editorView);
      await openReplace(page, "needle", "term");
      await expect(page.getByTestId("document-find-count")).toHaveText(
        "No results",
      );
      await expect(page.getByTestId("document-replace-current")).toBeDisabled();

      const editor =
        editorView === "rich-text" ? richTextEditor(page) : codeEditor(page);
      await editor.click();
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+End" : "Control+End",
      );
      await page.keyboard.type(" needle");

      await expect(page.getByTestId("document-find-count")).toHaveText(
        "1 of 1",
      );
      await expect(page.getByTestId("document-replace-current")).toBeEnabled();
      await page.getByTestId("document-replace-current").click();
      await expect(editor).toContainText("term");
      await expect
        .poll(() => readProjectFile(projectDir, filename))
        .toContain("term");
      logE2eEvent("document-replace.late-match", {
        editorView,
        file: filename,
        persisted: true,
      });
    });
  }

  test("rich-text replacement preserves comment and suggestion annotations", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "annotated-replace.md",
      [
        "# Annotated",
        "",
        'Commented {==Needle==}{>>Keep attached<<}{id="c1" by="user" at="2026-04-23T18:00:00.000Z"}.',
        "",
        'Suggested {++NEEDLE++}{id="s1" by="user" at="2026-04-23T18:01:00.000Z"}.',
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath, "rich-text");
    await openReplace(page, "needle", "term");
    await page.getByTestId("document-replace-all").click();

    await expect(richTextEditor(page)).toContainText("Commented term.");
    await expect(richTextEditor(page)).toContainText("Suggested term.");
    await expect
      .poll(() => readProjectFile(projectDir, "annotated-replace.md"))
      .toContain("{==term==}{>>Keep attached<<}{#c1}");
    expect(readProjectFile(projectDir, "annotated-replace.md")).toContain(
      "{++term++}{#s1}",
    );
    logE2eEvent("document-replace.annotations-preserved", {
      editorView: "rich-text",
      file: "annotated-replace.md",
      annotations: ["comment", "suggestion"],
    });
  });

  test("replace all in code view treats replacement characters literally and undoes once", async ({
    page,
  }) => {
    const original = "# Literal\n\nNeedle needle NEEDLE.\n";
    const replaced = "# Literal\n\n$&<tag> $&<tag> $&<tag>.\n";
    const filePath = writeProjectFile(
      projectDir,
      "code-replace-all.md",
      original,
    );

    await openMarkdownFile(page, filePath, "code");
    await openReplace(page, "needle", "$&<tag>");
    logE2eEvent("document-replace.action", {
      action: "replace-all",
      editorView: "code",
      replacement: "$&<tag>",
    });
    await page.getByTestId("document-replace-all").click();

    await expect(codeEditor(page)).toContainText("$&<tag> $&<tag> $&<tag>.");
    await expect
      .poll(() => readProjectFile(projectDir, "code-replace-all.md"))
      .toBe(replaced);

    await page.getByTestId("document-find-close").click();
    await expect(page.getByTestId("document-find-bar")).toBeHidden();
    await codeEditor(page).focus();
    await undoInBrowser(page);
    await expect(codeEditor(page)).toContainText("Needle needle NEEDLE.");
    await expect
      .poll(() => readProjectFile(projectDir, "code-replace-all.md"))
      .toBe(original);
    logE2eEvent("document-replace.undo-persisted", {
      editorView: "code",
      file: "code-replace-all.md",
      restored: true,
    });
  });

  test("replace all in rich text preserves each mark and is one undo step", async ({
    page,
  }) => {
    const original = "# Marked\n\n**Needle** _needle_ `NEEDLE`\n";
    const replaced = "# Marked\n\n**term** _term_ `term`\n";
    const filePath = writeProjectFile(
      projectDir,
      "rich-replace-all.md",
      original,
    );

    await openMarkdownFile(page, filePath, "rich-text");
    await openReplace(page, "needle", "term");
    logE2eEvent("document-replace.action", {
      action: "replace-all",
      editorView: "rich-text",
      markedMatches: 3,
    });
    await page.getByTestId("document-replace-all").click();

    const editor = richTextEditor(page);
    await expect(editor.locator("strong")).toHaveText("term"); // selector-check-ignore -- semantic formatting preservation is the behaviour under test
    await expect(editor.locator("em")).toHaveText("term"); // selector-check-ignore -- semantic formatting preservation is the behaviour under test
    await expect(editor.locator("code")).toHaveText("term"); // selector-check-ignore -- semantic formatting preservation is the behaviour under test
    await expect
      .poll(() => readProjectFile(projectDir, "rich-replace-all.md"))
      .toBe(replaced);

    await page.getByTestId("document-find-close").click();
    await expect(page.getByTestId("document-find-bar")).toBeHidden();
    await editor.focus();
    await undoInBrowser(page);
    await expect(editor.locator("strong")).toHaveText("Needle"); // selector-check-ignore -- semantic formatting restoration is the behaviour under test
    await expect(editor.locator("em")).toHaveText("needle"); // selector-check-ignore -- semantic formatting restoration is the behaviour under test
    await expect(editor.locator("code")).toHaveText("NEEDLE"); // selector-check-ignore -- semantic formatting restoration is the behaviour under test
    await expect
      .poll(() => readProjectFile(projectDir, "rich-replace-all.md"))
      .toBe(original);
    logE2eEvent("document-replace.undo-persisted", {
      editorView: "rich-text",
      file: "rich-replace-all.md",
      restoredMarks: ["strong", "em", "code"],
    });
  });
});
